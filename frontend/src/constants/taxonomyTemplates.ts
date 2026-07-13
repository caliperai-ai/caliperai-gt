
import type { ClassDefinition, SharedAttributeDefinition, TaxonomyAnnotationMode } from '@/types';


export interface TaxonomyTemplate {
  id: string;
  name: string;
  description: string;
  annotation_mode: TaxonomyAnnotationMode;
  classes: ClassDefinition[];
  shared_attributes: SharedAttributeDefinition[];
  annotation_rules: {
    min_points_polyline: number;
    min_points_polygon: number;
    allow_overlapping_boxes: boolean;
    require_track_id: boolean;
  };
}


const FUSION_3D_CLASSES: ClassDefinition[] = [
  {
    id: 'car',
    name: 'Car',
    color: '#FF6B6B',
    type: ['cuboid', 'box2d'],
    default_dimensions: [4.5, 1.8, 1.5],
    description: 'Passenger vehicles including sedans, coupes, hatchbacks, and SUVs',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        description: 'Level of occlusion by other objects',
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        description: 'How much of the object extends outside the frame',
        mutable: true,
      },
      state: {
        type: 'enum',
        options: ['moving', 'parked', 'stopped'],
        default: 'moving',
        required: false,
        description: 'Current motion state of the vehicle',
        mutable: true,
      },
      lane_id: {
        type: 'string',
        default: '',
        required: false,
        description: 'Lane identifier the vehicle is in',
        mutable: true,
      },
      is_ego: {
        type: 'boolean',
        default: false,
        required: false,
        description: 'Whether this is the ego vehicle',
        mutable: false,
      },
    },
  },
  {
    id: 'truck',
    name: 'Truck',
    color: '#4ECDC4',
    type: ['cuboid', 'box2d'],
    default_dimensions: [8.0, 2.5, 3.0],
    description: 'Pickup trucks, delivery trucks, semi-trucks without trailers',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      state: {
        type: 'enum',
        options: ['moving', 'parked', 'stopped'],
        default: 'moving',
        required: false,
        mutable: true,
      },
      has_trailer: {
        type: 'boolean',
        default: false,
        required: false,
        description: 'Whether the truck is towing a trailer',
        mutable: false,
      },
    },
  },
  {
    id: 'bus',
    name: 'Bus',
    color: '#45B7D1',
    type: ['cuboid', 'box2d'],
    default_dimensions: [12.0, 2.5, 3.5],
    description: 'City buses, school buses, coach buses',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      state: {
        type: 'enum',
        options: ['moving', 'parked', 'stopped'],
        default: 'moving',
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'motorcycle',
    name: 'Motorcycle',
    color: '#96CEB4',
    type: ['cuboid', 'box2d'],
    default_dimensions: [2.2, 0.8, 1.5],
    description: 'Motorcycles, scooters, mopeds',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      rider_present: {
        type: 'boolean',
        default: true,
        required: false,
        description: 'Whether someone is riding the motorcycle',
        mutable: true,
      },
      helmet_worn: {
        type: 'boolean',
        default: true,
        required: false,
        description: 'Whether the rider is wearing a helmet',
        mutable: true,
      },
    },
  },
  {
    id: 'bicycle',
    name: 'Bicycle',
    color: '#FFEAA7',
    type: ['cuboid', 'box2d'],
    default_dimensions: [1.8, 0.6, 1.2],
    description: 'Bicycles, e-bikes, tricycles',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      rider_present: {
        type: 'boolean',
        default: true,
        required: false,
        description: 'Whether someone is riding the bicycle',
        mutable: true,
      },
      helmet_worn: {
        type: 'boolean',
        default: false,
        required: false,
        description: 'Whether the rider is wearing a helmet',
        mutable: true,
      },
    },
  },
  {
    id: 'pedestrian',
    name: 'Pedestrian',
    color: '#DDA0DD',
    type: ['cuboid', 'box2d'],
    default_dimensions: [0.5, 0.5, 1.7],
    description: 'People walking, standing, or sitting',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      pose: {
        type: 'enum',
        options: ['standing', 'walking', 'sitting', 'lying'],
        default: 'standing',
        required: false,
        description: 'Current posture of the pedestrian',
        mutable: true,
      },
      age_group: {
        type: 'enum',
        options: ['adult', 'child'],
        default: 'adult',
        required: false,
        description: 'Estimated age group',
        mutable: false,
      },
      carrying_object: {
        type: 'boolean',
        default: false,
        required: false,
        description: 'Whether carrying bags, stroller, etc.',
        mutable: true,
      },
    },
  },
  {
    id: 'traffic_cone',
    name: 'Traffic Cone',
    color: '#F7DC6F',
    type: ['cuboid', 'box2d'],
    default_dimensions: [0.3, 0.3, 0.5],
    description: 'Orange traffic cones used for road work or events',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
    },
  },
  {
    id: 'barrier',
    name: 'Barrier',
    color: '#BB8FCE',
    type: ['cuboid', 'box2d'],
    default_dimensions: [2.0, 0.4, 1.0],
    description: 'Road barriers, jersey barriers, construction barriers',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      barrier_type: {
        type: 'enum',
        options: ['concrete', 'plastic', 'metal'],
        default: 'concrete',
        required: false,
        description: 'Material type of the barrier',
        mutable: false,
      },
    },
  },
  {
    id: 'construction_vehicle',
    name: 'Construction Vehicle',
    color: '#85C1E9',
    type: ['cuboid', 'box2d'],
    default_dimensions: [6.0, 2.5, 2.5],
    description: 'Excavators, cranes, forklifts, and other construction equipment',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      vehicle_type: {
        type: 'enum',
        options: ['excavator', 'crane', 'forklift', 'bulldozer', 'other'],
        default: 'other',
        required: false,
        description: 'Type of construction vehicle',
        mutable: false,
      },
    },
  },
  {
    id: 'trailer',
    name: 'Trailer',
    color: '#F8B500',
    type: ['cuboid', 'box2d'],
    default_dimensions: [6.0, 2.5, 2.5],
    description: 'Trailers attached to trucks or standalone',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      attached: {
        type: 'boolean',
        default: true,
        required: false,
        description: 'Whether the trailer is attached to a vehicle',
        mutable: true,
      },
    },
  },
];

const FUSION_3D_SHARED_ATTRIBUTES: SharedAttributeDefinition[] = [
  {
    name: 'difficulty',
    type: 'enum',
    options: ['easy', 'moderate', 'hard'],
    default: 'moderate',
    required: false,
    description: 'Annotation difficulty level',
    mutable: true,
    applies_to: ['__all__'],
  },
  {
    name: 'is_group',
    type: 'boolean',
    default: false,
    required: false,
    description: 'Whether this annotation represents a group of objects',
    mutable: false,
    applies_to: ['__all__'],
  },
];


const ONLY_2D_CLASSES: ClassDefinition[] = [
  {
    id: 'lane_divider',
    name: 'Lane Divider',
    color: '#FFD700',
    type: ['polyline'],
    description: 'Lines that divide lanes on the road',
    attributes: {
      line_type: {
        type: 'enum',
        options: ['solid', 'dashed', 'double_solid', 'double_dashed', 'solid_dashed'],
        default: 'solid',
        required: true,
        description: 'Type of lane divider marking',
        mutable: false,
      },
      color: {
        type: 'enum',
        options: ['white', 'yellow', 'blue'],
        default: 'white',
        required: true,
        description: 'Color of the lane divider',
        mutable: false,
      },
      position: {
        type: 'enum',
        options: ['left', 'center', 'right'],
        default: 'center',
        required: false,
        description: 'Position relative to ego lane',
        mutable: true,
      },
    },
  },
  {
    id: 'lane_boundary',
    name: 'Lane Boundary',
    color: '#00CED1',
    type: ['polyline'],
    description: 'Road edges and lane boundaries',
    attributes: {
      boundary_type: {
        type: 'enum',
        options: ['curb', 'edge', 'marking', 'barrier'],
        default: 'marking',
        required: true,
        description: 'Type of boundary',
        mutable: false,
      },
      crossable: {
        type: 'boolean',
        default: true,
        required: false,
        description: 'Whether vehicles can cross this boundary',
        mutable: false,
      },
    },
  },
  {
    id: 'drivable_area',
    name: 'Drivable Area',
    color: '#32CD32',
    type: ['polygon'],
    description: 'Area where vehicles can drive',
    attributes: {
      surface_type: {
        type: 'enum',
        options: ['asphalt', 'concrete', 'gravel', 'dirt'],
        default: 'asphalt',
        required: false,
        description: 'Road surface material',
        mutable: false,
      },
      condition: {
        type: 'enum',
        options: ['good', 'wet', 'icy', 'damaged'],
        default: 'good',
        required: false,
        description: 'Current road condition',
        mutable: true,
      },
    },
  },
  {
    id: 'crosswalk',
    name: 'Crosswalk',
    color: '#FF69B4',
    type: ['polygon'],
    description: 'Pedestrian crossing areas',
    attributes: {
      type: {
        type: 'enum',
        options: ['zebra', 'solid', 'textured', 'unmarked'],
        default: 'zebra',
        required: true,
        description: 'Type of crosswalk marking',
        mutable: false,
      },
      has_signal: {
        type: 'boolean',
        default: false,
        required: false,
        description: 'Whether controlled by a pedestrian signal',
        mutable: false,
      },
    },
  },
  {
    id: 'stop_line',
    name: 'Stop Line',
    color: '#FF4500',
    type: ['polyline'],
    description: 'Line where vehicles must stop',
    attributes: {
      color: {
        type: 'enum',
        options: ['white', 'yellow'],
        default: 'white',
        required: false,
        description: 'Color of the stop line',
        mutable: false,
      },
    },
  },
  {
    id: 'traffic_sign',
    name: 'Traffic Sign',
    color: '#FF6347',
    type: ['box2d'],
    description: 'Road signs including speed limits, warnings, regulations',
    attributes: {
      sign_type: {
        type: 'enum',
        options: ['speed_limit', 'stop', 'yield', 'warning', 'regulatory', 'informational', 'other'],
        default: 'regulatory',
        required: true,
        description: 'Category of traffic sign',
        mutable: false,
      },
      value: {
        type: 'string',
        default: '',
        required: false,
        description: 'Text or value on the sign (e.g., "50" for speed limit)',
        mutable: false,
      },
      visibility: {
        type: 'enum',
        options: ['clear', 'obscured', 'damaged'],
        default: 'clear',
        required: false,
        description: 'Visibility condition of the sign',
        mutable: true,
      },
    },
  },
  {
    id: 'traffic_light',
    name: 'Traffic Light',
    color: '#98D8C8',
    type: ['box2d'],
    description: 'Traffic signals for vehicles and pedestrians',
    attributes: {
      state: {
        type: 'enum',
        options: ['red', 'yellow', 'green', 'off', 'flashing_red', 'flashing_yellow'],
        default: 'red',
        required: true,
        description: 'Current state of the traffic light',
        mutable: true,
      },
      orientation: {
        type: 'enum',
        options: ['vertical', 'horizontal'],
        default: 'vertical',
        required: false,
        description: 'Orientation of the light fixture',
        mutable: false,
      },
      arrow_direction: {
        type: 'enum',
        options: ['none', 'left', 'right', 'straight', 'u_turn'],
        default: 'none',
        required: false,
        description: 'Direction if arrow light present',
        mutable: false,
      },
    },
  },
  {
    id: 'road_marking',
    name: 'Road Marking',
    color: '#9370DB',
    type: ['polygon'],
    description: 'Arrows, text, and symbols painted on the road',
    attributes: {
      marking_type: {
        type: 'enum',
        options: ['arrow', 'text', 'symbol', 'other'],
        default: 'arrow',
        required: true,
        description: 'Type of road marking',
        mutable: false,
      },
      arrow_direction: {
        type: 'enum',
        options: ['left', 'right', 'straight', 'u_turn', 'left_straight', 'right_straight', 'none'],
        default: 'none',
        required: false,
        description: 'Direction if marking is an arrow',
        mutable: false,
      },
    },
  },
  {
    id: 'parking_space',
    name: 'Parking Space',
    color: '#87CEEB',
    type: ['polygon'],
    description: 'Individual parking spots',
    attributes: {
      occupied: {
        type: 'boolean',
        default: false,
        required: false,
        description: 'Whether the space is currently occupied',
        mutable: true,
      },
      type: {
        type: 'enum',
        options: ['parallel', 'perpendicular', 'angled', 'disabled'],
        default: 'perpendicular',
        required: false,
        description: 'Type of parking space',
        mutable: false,
      },
    },
  },
  {
    id: 'sidewalk',
    name: 'Sidewalk',
    color: '#B8860B',
    type: ['polygon'],
    description: 'Pedestrian walking areas adjacent to roads',
    attributes: {
      surface_type: {
        type: 'enum',
        options: ['concrete', 'brick', 'asphalt', 'gravel'],
        default: 'concrete',
        required: false,
        description: 'Surface material of the sidewalk',
        mutable: false,
      },
    },
  },
];

const ONLY_2D_SHARED_ATTRIBUTES: SharedAttributeDefinition[] = [
  {
    name: 'occlusion',
    type: 'enum',
    options: ['none', 'partial', 'heavy'],
    default: 'none',
    required: false,
    description: 'Level of occlusion by other objects',
    mutable: true,
    applies_to: ['__all__'],
  },
  {
    name: 'confidence',
    type: 'enum',
    options: ['high', 'medium', 'low'],
    default: 'high',
    required: false,
    description: 'Annotator confidence level',
    mutable: true,
    applies_to: ['__all__'],
  },
];


const OBJECT_DETECTION_2D_CLASSES: ClassDefinition[] = [
  {
    id: 'car',
    name: 'Car',
    color: '#FF6B6B',
    type: ['box2d'],
    description: 'Passenger vehicles including sedans, coupes, hatchbacks, and SUVs',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      orientation: {
        type: 'enum',
        options: ['front', 'rear', 'side', 'unknown'],
        default: 'unknown',
        required: false,
        description: 'Visible orientation of the vehicle',
        mutable: true,
      },
    },
  },
  {
    id: 'truck',
    name: 'Truck',
    color: '#4ECDC4',
    type: ['box2d'],
    description: 'Pickup trucks, delivery trucks, semi-trucks',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      orientation: {
        type: 'enum',
        options: ['front', 'rear', 'side', 'unknown'],
        default: 'unknown',
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'pedestrian',
    name: 'Pedestrian',
    color: '#DDA0DD',
    type: ['box2d'],
    description: 'People walking, standing, or sitting',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      pose: {
        type: 'enum',
        options: ['standing', 'walking', 'sitting', 'lying'],
        default: 'standing',
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'bicycle',
    name: 'Bicycle',
    color: '#FFEAA7',
    type: ['box2d'],
    description: 'Bicycles, e-bikes, tricycles',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      rider_present: {
        type: 'boolean',
        default: true,
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'motorcycle',
    name: 'Motorcycle',
    color: '#96CEB4',
    type: ['box2d'],
    description: 'Motorcycles, scooters, mopeds',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      rider_present: {
        type: 'boolean',
        default: true,
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'traffic_sign',
    name: 'Traffic Sign',
    color: '#FF6347',
    type: ['box2d'],
    description: 'Road signs including speed limits, warnings, regulations',
    attributes: {
      sign_type: {
        type: 'enum',
        options: ['speed_limit', 'stop', 'yield', 'warning', 'regulatory', 'informational'],
        default: 'regulatory',
        required: true,
        mutable: false,
      },
      value: {
        type: 'string',
        default: '',
        required: false,
        description: 'Text or value on the sign (e.g., "50" for speed limit)',
        mutable: false,
      },
      visibility: {
        type: 'enum',
        options: ['clear', 'obscured', 'damaged'],
        default: 'clear',
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'traffic_light',
    name: 'Traffic Light',
    color: '#98D8C8',
    type: ['box2d'],
    description: 'Traffic signals for vehicles and pedestrians',
    attributes: {
      state: {
        type: 'enum',
        options: ['red', 'yellow', 'green', 'off', 'flashing'],
        default: 'red',
        required: true,
        mutable: true,
      },
      arrow_direction: {
        type: 'enum',
        options: ['none', 'left', 'right', 'straight'],
        default: 'none',
        required: false,
        mutable: false,
      },
    },
  },
];

const OBJECT_DETECTION_2D_SHARED_ATTRIBUTES: SharedAttributeDefinition[] = [
  {
    name: 'difficulty',
    type: 'enum',
    options: ['easy', 'moderate', 'hard'],
    default: 'moderate',
    required: false,
    description: 'Annotation difficulty level',
    mutable: true,
    applies_to: ['__all__'],
  },
  {
    name: 'is_group',
    type: 'boolean',
    default: false,
    required: false,
    description: 'Whether this annotation represents a group of objects',
    mutable: false,
    applies_to: ['__all__'],
  },
];


const SEMANTIC_SEGMENTATION_CLASSES: ClassDefinition[] = [
  {
    id: 'road',
    name: 'Road',
    color: '#808080',
    type: ['polygon', 'segmentation_2d'],
    description: 'Drivable road surface',
    attributes: {
      surface: {
        type: 'enum',
        options: ['asphalt', 'concrete', 'gravel', 'dirt'],
        default: 'asphalt',
        required: false,
        mutable: false,
      },
      condition: {
        type: 'enum',
        options: ['dry', 'wet', 'icy', 'damaged'],
        default: 'dry',
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'sidewalk',
    name: 'Sidewalk',
    color: '#F0E68C',
    type: ['polygon', 'segmentation_2d'],
    description: 'Pedestrian walking areas',
    attributes: {
      surface: {
        type: 'enum',
        options: ['concrete', 'brick', 'asphalt', 'gravel'],
        default: 'concrete',
        required: false,
        mutable: false,
      },
    },
  },
  {
    id: 'building',
    name: 'Building',
    color: '#708090',
    type: ['polygon', 'segmentation_2d'],
    description: 'Buildings and structures',
    attributes: {
      type: {
        type: 'enum',
        options: ['residential', 'commercial', 'industrial', 'other'],
        default: 'other',
        required: false,
        mutable: false,
      },
    },
  },
  {
    id: 'vegetation',
    name: 'Vegetation',
    color: '#228B22',
    type: ['polygon', 'segmentation_2d'],
    description: 'Trees, bushes, grass, and plants',
    attributes: {
      type: {
        type: 'enum',
        options: ['tree', 'bush', 'grass', 'other'],
        default: 'tree',
        required: false,
        mutable: false,
      },
    },
  },
  {
    id: 'sky',
    name: 'Sky',
    color: '#87CEEB',
    type: ['polygon', 'segmentation_2d'],
    description: 'Sky region',
    attributes: {
      weather: {
        type: 'enum',
        options: ['clear', 'cloudy', 'overcast', 'rainy'],
        default: 'clear',
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'terrain',
    name: 'Terrain',
    color: '#D2B48C',
    type: ['polygon', 'segmentation_2d'],
    description: 'Non-road ground surfaces',
    attributes: {
      type: {
        type: 'enum',
        options: ['soil', 'sand', 'rock', 'gravel'],
        default: 'soil',
        required: false,
        mutable: false,
      },
    },
  },
  {
    id: 'water',
    name: 'Water',
    color: '#4169E1',
    type: ['polygon', 'segmentation_2d'],
    description: 'Bodies of water',
    attributes: {
      type: {
        type: 'enum',
        options: ['river', 'lake', 'puddle', 'ocean'],
        default: 'puddle',
        required: false,
        mutable: false,
      },
    },
  },
];

const SEMANTIC_SEGMENTATION_SHARED_ATTRIBUTES: SharedAttributeDefinition[] = [
  {
    name: 'confidence',
    type: 'enum',
    options: ['high', 'medium', 'low'],
    default: 'high',
    required: false,
    description: 'Annotator confidence level',
    mutable: true,
    applies_to: ['__all__'],
  },
];


const INSTANCE_SEGMENTATION_CLASSES: ClassDefinition[] = [
  {
    id: 'car',
    name: 'Car',
    color: '#FF6B6B',
    type: ['polygon', 'box2d'],
    description: 'Passenger vehicles - annotate with polygon mask',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
    },
  },
  {
    id: 'truck',
    name: 'Truck',
    color: '#4ECDC4',
    type: ['polygon', 'box2d'],
    description: 'Trucks and large vehicles - annotate with polygon mask',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
    },
  },
  {
    id: 'pedestrian',
    name: 'Pedestrian',
    color: '#DDA0DD',
    type: ['polygon', 'box2d'],
    description: 'People - annotate with polygon mask',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      truncation: {
        type: 'enum',
        options: ['none', 'partial', 'full'],
        default: 'none',
        required: true,
        mutable: true,
      },
      pose: {
        type: 'enum',
        options: ['standing', 'walking', 'sitting', 'lying'],
        default: 'standing',
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'bicycle',
    name: 'Bicycle',
    color: '#FFEAA7',
    type: ['polygon', 'box2d'],
    description: 'Bicycles - annotate with polygon mask',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      rider_present: {
        type: 'boolean',
        default: true,
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'motorcycle',
    name: 'Motorcycle',
    color: '#96CEB4',
    type: ['polygon', 'box2d'],
    description: 'Motorcycles - annotate with polygon mask',
    attributes: {
      occlusion: {
        type: 'enum',
        options: ['none', 'partial', 'heavy'],
        default: 'none',
        required: true,
        mutable: true,
      },
      rider_present: {
        type: 'boolean',
        default: true,
        required: false,
        mutable: true,
      },
    },
  },
  {
    id: 'traffic_sign',
    name: 'Traffic Sign',
    color: '#FF6347',
    type: ['polygon', 'box2d'],
    description: 'Traffic signs - annotate with polygon mask',
    attributes: {
      sign_type: {
        type: 'enum',
        options: ['speed_limit', 'stop', 'yield', 'warning', 'regulatory', 'informational'],
        default: 'regulatory',
        required: true,
        mutable: false,
      },
      value: {
        type: 'string',
        default: '',
        required: false,
        mutable: false,
      },
    },
  },
];

const INSTANCE_SEGMENTATION_SHARED_ATTRIBUTES: SharedAttributeDefinition[] = [
  {
    name: 'difficulty',
    type: 'enum',
    options: ['easy', 'moderate', 'hard'],
    default: 'moderate',
    required: false,
    description: 'Annotation difficulty level',
    mutable: true,
    applies_to: ['__all__'],
  },
  {
    name: 'is_crowd',
    type: 'boolean',
    default: false,
    required: false,
    description: 'Whether this represents a crowd/dense group (COCO-style)',
    mutable: false,
    applies_to: ['__all__'],
  },
];


const SEMANTIC_SEGMENTATION_3D_CLASSES: ClassDefinition[] = [
  {
    id: 'road',
    name: 'road',
    color: '#F77F7F',
    type: ['segmentation_3d'],
    description: 'Drivable road surface',
    attributes: {},
  },
  {
    id: 'lane_marking',
    name: 'lane_marking',
    color: '#ADFF2F',
    type: ['segmentation_3d'],
    description: 'Painted lane markings on the road',
    attributes: {},
  },
  {
    id: 'curb_road_edge',
    name: 'curb_road_edge',
    color: '#1E40FF',
    type: ['segmentation_3d'],
    description: 'Curbs and road edges separating drivable from non-drivable areas',
    attributes: {},
  },
  {
    id: 'sidewalk_pavement',
    name: 'sidewalk_pavement',
    color: '#A8D5BA',
    type: ['segmentation_3d'],
    description: 'Pedestrian sidewalks and paved areas adjacent to the road',
    attributes: {},
  },
  {
    id: 'vehicle',
    name: 'vehicle',
    color: '#FFF3B0',
    type: ['segmentation_3d'],
    description: 'Any on-road vehicle (cars, trucks, buses, motorcycles)',
    attributes: {},
  },
  {
    id: 'pole',
    name: 'pole',
    color: '#DDA0DD',
    type: ['segmentation_3d'],
    description: 'Vertical poles — sign posts, lamp posts, utility poles',
    attributes: {},
  },
  {
    id: 'wire_cable',
    name: 'wire_cable',
    color: '#B22222',
    type: ['segmentation_3d'],
    description: 'Overhead wires and cables',
    attributes: {},
  },
  {
    id: 'tree_vegetation',
    name: 'tree_vegetation',
    color: '#00C800',
    type: ['segmentation_3d'],
    description: 'Trees, bushes, and other vegetation',
    attributes: {},
  },
  {
    id: 'wall_barrier',
    name: 'wall_barrier',
    color: '#FF8C00',
    type: ['segmentation_3d'],
    description: 'Walls, fences, guardrails, and other barriers',
    attributes: {},
  },
  {
    id: 'unknown',
    name: 'unknown',
    color: '#87CEEB',
    type: ['segmentation_3d'],
    description: 'Points that do not belong to any other class',
    attributes: {},
  },
];



export const TAXONOMY_TEMPLATES: TaxonomyTemplate[] = [
  {
    id: 'ad_3d_objects',
    name: 'Autonomous Driving - 3D Objects',
    description: 'Standard 3D object detection taxonomy with 10 classes for autonomous driving. Includes vehicles, pedestrians, cyclists, and road infrastructure.',
    annotation_mode: 'fusion_3d',
    classes: FUSION_3D_CLASSES,
    shared_attributes: FUSION_3D_SHARED_ATTRIBUTES,
    annotation_rules: {
      min_points_polyline: 2,
      min_points_polygon: 3,
      allow_overlapping_boxes: false,
      require_track_id: true,
    },
  },
  {
    id: 'ad_3d_semantic_segmentation',
    name: 'Autonomous Driving - 3D Semantic Segmentation',
    description: 'LiDAR point-cloud semantic segmentation with 10 classes covering road surfaces, vehicles, vegetation, and infrastructure.',
    annotation_mode: 'segmentation_3d',
    classes: SEMANTIC_SEGMENTATION_3D_CLASSES,
    shared_attributes: [],
    annotation_rules: {
      min_points_polyline: 2,
      min_points_polygon: 3,
      allow_overlapping_boxes: false,
      require_track_id: false,
    },
  },
  {
    id: 'ad_2d_lanes_signs',
    name: 'Autonomous Driving - Lanes & Signs',
    description: 'Standard 2D annotation taxonomy for lanes, traffic signs, drivable areas, and road features. 10 classes covering common road elements.',
    annotation_mode: '2d_only',
    classes: ONLY_2D_CLASSES,
    shared_attributes: ONLY_2D_SHARED_ATTRIBUTES,
    annotation_rules: {
      min_points_polyline: 2,
      min_points_polygon: 3,
      allow_overlapping_boxes: true,
      require_track_id: false,
    },
  },
  {
    id: '2d_object_detection',
    name: '2D Object Detection',
    description: 'Bounding box detection for common objects in camera images. 7 core classes: vehicles, pedestrians, cyclists, and traffic elements.',
    annotation_mode: '2d_only',
    classes: OBJECT_DETECTION_2D_CLASSES,
    shared_attributes: OBJECT_DETECTION_2D_SHARED_ATTRIBUTES,
    annotation_rules: {
      min_points_polyline: 2,
      min_points_polygon: 3,
      allow_overlapping_boxes: true,
      require_track_id: true,
    },
  },
  {
    id: 'semantic_segmentation',
    name: 'Semantic Segmentation',
    description: 'Pixel-level scene parsing with polygon masks. 7 core classes for road, sidewalk, buildings, vegetation, sky, terrain, and water.',
    annotation_mode: '2d_only',
    classes: SEMANTIC_SEGMENTATION_CLASSES,
    shared_attributes: SEMANTIC_SEGMENTATION_SHARED_ATTRIBUTES,
    annotation_rules: {
      min_points_polyline: 2,
      min_points_polygon: 4,
      allow_overlapping_boxes: false,
      require_track_id: false,
    },
  },
  {
    id: 'instance_segmentation',
    name: 'Instance Segmentation',
    description: 'Object instance detection with polygon masks. 6 core classes combining bounding boxes with precise object boundaries.',
    annotation_mode: '2d_only',
    classes: INSTANCE_SEGMENTATION_CLASSES,
    shared_attributes: INSTANCE_SEGMENTATION_SHARED_ATTRIBUTES,
    annotation_rules: {
      min_points_polyline: 2,
      min_points_polygon: 4,
      allow_overlapping_boxes: true,
      require_track_id: true,
    },
  },
];

export const getTaxonomyTemplate = (id: string): TaxonomyTemplate | undefined => {
  return TAXONOMY_TEMPLATES.find(t => t.id === id);
};

export const getTemplatesByMode = (mode: TaxonomyAnnotationMode): TaxonomyTemplate[] => {
  return TAXONOMY_TEMPLATES.filter(t => t.annotation_mode === mode);
};
