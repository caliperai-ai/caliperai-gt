
let boxDoubleClickedFlag3D = false;

let boxDoubleClickedFlag4D = false;

export const setBoxDoubleClickedFlag3D = () => {
  console.log('[DoubleClickFlags] 3D flag set');
  boxDoubleClickedFlag3D = true;
};

export const getBoxDoubleClickedFlag3D = (): boolean => {
  return boxDoubleClickedFlag3D;
};

export const clearBoxDoubleClickedFlag3D = () => {
  boxDoubleClickedFlag3D = false;
};

export const setBoxDoubleClickedFlag4D = () => {
  console.log('[DoubleClickFlags] 4D flag set');
  boxDoubleClickedFlag4D = true;
};

export const getBoxDoubleClickedFlag4D = (): boolean => {
  return boxDoubleClickedFlag4D;
};

export const clearBoxDoubleClickedFlag4D = () => {
  boxDoubleClickedFlag4D = false;
};
