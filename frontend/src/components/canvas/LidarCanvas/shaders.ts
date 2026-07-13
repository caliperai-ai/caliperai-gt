
export const pointCloudVertexShader = `
  attribute float intensity;
  attribute float label;
  attribute float inFrustum;
  attribute float isGround;  // RANSAC-detected ground mask (1.0 = ground, 0.0 = not ground)
  attribute float isSelected; // Segment-to-3D selected points (1.0 = selected, 0.0 = not selected)
  attribute float heightAboveGround; // Local grid-based height above ground

  varying float vIntensity;
  varying float vLabel;
  varying float vHeight;
  varying float vInFrustum;
  varying float vIsGround;
  varying float vIsSelected;
  varying float vClipped;   // 1.0 if outside clip box
  varying float vHeightAboveGround;

  uniform float pointSize;
  uniform float frustumSizeBoost;

  // Clip box uniforms (in world/LiDAR space from origin)
  uniform bool  useClipBox;
  uniform float clipXMin;
  uniform float clipXMax;
  uniform float clipYMin;
  uniform float clipYMax;
  uniform float clipZMin;
  uniform float clipZMax;

  void main() {
    vIntensity = intensity;
    vLabel = label;
    vHeight = position.z;
    vInFrustum = inFrustum;
    vIsGround = isGround;
    vIsSelected = isSelected;
    vHeightAboveGround = heightAboveGround;

    // Clip box test
    if (useClipBox) {
      bool outside = position.x < clipXMin || position.x > clipXMax ||
                     position.y < clipYMin || position.y > clipYMax ||
                     position.z < clipZMin || position.z > clipZMax;
      vClipped = outside ? 1.0 : 0.0;
    } else {
      vClipped = 0.0;
    }

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Perspective-based point size with attenuation
    // Use sqrt for gentler falloff - prevents close points from being too large
    float distance = -mvPosition.z;
    float perspectiveScale = 150.0 / max(distance, 1.0);

    // Apply sqrt for gentler scaling - reduces extreme size differences
    float rawSize = pointSize * sqrt(perspectiveScale);

    // Boost size for points in camera frustum
    float sizeMultiplier = mix(1.0, frustumSizeBoost, inFrustum);
    rawSize *= sizeMultiplier;

    // Clamp point size to reasonable range (min 1.5, max boosted)
    // Selected points get 3x size boost for visibility (render as stars)
    float selectionBoost = mix(1.0, 3.0, isSelected);
    rawSize *= selectionBoost;
    gl_PointSize = clamp(rawSize, 1.5, 24.0 * max(1.0, frustumSizeBoost));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const pointCloudFragmentShader = `
  varying float vIntensity;
  varying float vLabel;
  varying float vHeight;
  varying float vInFrustum;
  varying float vIsGround;
  varying float vIsSelected;
  varying float vClipped;   // 1.0 if outside clip box
  varying float vHeightAboveGround;

  uniform int colorMode; // 0: intensity, 1: height, 2: class, 3: height_above_ground
  uniform vec3 classColors[32];
  uniform float minHeight;
  uniform float maxHeight;
  uniform float maxAboveGround;  // max height above ground for color mapping
  uniform float focusBand;         // height threshold (m) for dual-band split (default 3.0)
  uniform float frustumSizeBoost;
  uniform vec3 groundColor;         // Color for ground plane points (white)
  uniform bool showGroundPlane;     // Whether to highlight ground plane
  uniform vec3 selectedColor;       // Color for segment-selected points (bright cyan)

  // Diamond shape function - returns true if point is inside a diamond (rotated square)
  bool isInsideDiamond(vec2 uv, float radius) {
    vec2 centered = abs(uv - vec2(0.5));
    // Diamond: |x| + |y| <= radius (L1 norm / Manhattan distance)
    return (centered.x + centered.y) <= radius;
  }

  vec3 getIntensityColor(float intensity) {
    // Logarithmic intensity mapping to make ground (low intensity) visible
    // while preserving high intensity features
    float v = max(0.0, intensity);
    float i = log(1.0 + v * 19.0) / log(20.0);
    return vec3(i, i, i);
  }

  vec3 getHeightColor(float height) {
    // Rainbow gradient based on height
    float t = clamp((height - minHeight) / (maxHeight - minHeight), 0.0, 1.0);

    // Non-linear mapping (Gamma correction style) to expand the bottom range
    t = pow(t, 0.6);

    vec3 color;
    if (t < 0.25) {
      color = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), t * 4.0);
    } else if (t < 0.5) {
      color = mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.25) * 4.0);
    } else if (t < 0.75) {
      color = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.5) * 4.0);
    } else {
      color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.75) * 4.0);
    }
    return color;
  }

  // Turbo colormap - perceptually uniform, high contrast
  // Approximation of Google's Turbo colormap
  vec3 turboColormap(float t) {
    t = clamp(t, 0.0, 1.0);
    // Red channel
    float r = 0.13572 + t * (4.61539 + t * (-42.6603 + t * (132.139 + t * (-152.482 + t * 56.4813))));
    // Green channel
    float g = 0.09140 + t * (2.26344 + t * (-11.6875 + t * (27.6038 + t * (-24.4469 + t * 7.1702))));
    // Blue channel
    float b = 0.10667 + t * (12.7578 + t * (-60.5821 + t * (109.702 + t * (-82.2891 + t * 21.3811))));
    return clamp(vec3(r, g, b), 0.0, 1.0);
  }

  vec3 getHeightAboveGroundColor(float hag) {
    // Points near ground (< 0.3m) get muted dark grey-blue
    if (hag < 0.3) {
      float groundT = clamp(hag / 0.3, 0.0, 1.0);
      return mix(vec3(0.15, 0.15, 0.22), vec3(0.22, 0.22, 0.35), groundT);
    }
    // Dual-band colormap:
    //   Band 1: [0.3, focusBand] -> 80% of Turbo spectrum (t 0.0 - 0.8)
    //   Band 2: [focusBand, maxAboveGround] -> 20% of Turbo spectrum (t 0.8 - 1.0)
    float t;
    if (hag < focusBand) {
      // Focus band: road detail (curbs, bumpers, hoods, vehicles)
      t = clamp((hag - 0.3) / (focusBand - 0.3), 0.0, 1.0) * 0.8;
    } else {
      // Upper band: tall objects (signs, trees, buildings)
      t = 0.8 + clamp((hag - focusBand) / (maxAboveGround - focusBand), 0.0, 1.0) * 0.2;
    }
    return turboColormap(t);
  }

  vec3 getClassColor(float label) {
    int idx = int(label);
    if (idx < 0 || idx >= 32) return vec3(0.5, 0.5, 0.5);
    return classColors[idx];
  }

  void main() {
    // Discard points outside the clip box
    if (vClipped > 0.5) discard;

    vec2 center = gl_PointCoord - vec2(0.5);

    // Selected points render as diamonds, others as circles
    if (vIsSelected > 0.5) {
      // Diamond shape for selected points (radius 0.45 for good visibility)
      if (!isInsideDiamond(gl_PointCoord, 0.45)) discard;
      gl_FragColor = vec4(selectedColor, 1.0);
      return;
    }

    // Circular point shape for non-selected points
    if (dot(center, center) > 0.25) discard;

    vec3 color;

    // Check if this is a RANSAC-detected ground point
    if (showGroundPlane && vIsGround > 0.5) {
      color = groundColor;
    } else if (colorMode == 0) {
      color = getIntensityColor(vIntensity);
    } else if (colorMode == 1) {
      color = getHeightColor(vHeight);
    } else if (colorMode == 3) {
      color = getHeightAboveGroundColor(vHeightAboveGround);
    } else {
      color = getClassColor(vLabel);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;
