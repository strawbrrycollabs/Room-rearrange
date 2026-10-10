export type Pt = { x: number; y: number };

export type OpeningKind = 'door' | 'window' | 'radiator';

/** Wall `wall` runs from corners[wall] to corners[wall + 1]. `offset` is the distance (cm) from the start corner to the opening's near edge. */
export type Opening = {
  id: string;
  kind: OpeningKind;
  wall: number;
  offset: number;
  width: number;
  height: number;
  /** Height above the floor (cm). */
  sill: number;
  /** Doors only. */
  swing: 'in' | 'out';
  hinge: 'start' | 'end';
};

export type Category =
  | 'bed' | 'sofa' | 'chair' | 'table' | 'desk' | 'wardrobe' | 'shelf'
  | 'tv' | 'rug' | 'lamp' | 'plant' | 'other';

export type Material = 'matte' | 'wood' | 'metal' | 'fabric' | 'glass';

export type Furniture = {
  id: string;
  name: string;
  category: Category;
  shape: 'box' | 'round';
  /** Centre of the item in room coordinates (cm). */
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
  color: string;
  material: Material;
  locked: boolean;
  /** Flat floor coverings (rugs) never count as collisions. */
  flat: boolean;
};

export type Layout = { id: string; name: string; items: Furniture[] };

export type Room = {
  id: string;
  name: string;
  /** Clockwise (on screen) polygon in cm. */
  corners: Pt[];
  ceilingHeight: number;
  openings: Opening[];
  layouts: Layout[];
  activeLayoutId: string;
  updatedAt: number;
};

export type Unit = 'metric' | 'imperial';
export type Theme = 'light' | 'dark' | 'system';
