import type { Category, Furniture } from './types';

export type CatalogItem = {
  id: string;
  name: string;
  category: Category;
  shape?: 'box' | 'round';
  width: number;
  depth: number;
  height: number;
  color: string;
  material?: Furniture['material'];
  flat?: boolean;
};

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'bed', label: 'Beds' },
  { id: 'sofa', label: 'Sofas' },
  { id: 'chair', label: 'Chairs' },
  { id: 'table', label: 'Tables' },
  { id: 'desk', label: 'Desks' },
  { id: 'wardrobe', label: 'Wardrobes' },
  { id: 'shelf', label: 'Shelves' },
  { id: 'tv', label: 'TV units' },
  { id: 'rug', label: 'Rugs' },
  { id: 'lamp', label: 'Lamps' },
  { id: 'plant', label: 'Plants' },
];

export const CATALOG: CatalogItem[] = [
  { id: 'bed-single', name: 'Single bed', category: 'bed', width: 90, depth: 200, height: 45, color: '#c7d2fe', material: 'fabric' },
  { id: 'bed-double', name: 'Double bed', category: 'bed', width: 160, depth: 200, height: 45, color: '#c7d2fe', material: 'fabric' },
  { id: 'bed-king', name: 'King bed', category: 'bed', width: 180, depth: 210, height: 45, color: '#c7d2fe', material: 'fabric' },
  { id: 'sofa-2', name: '2-seat sofa', category: 'sofa', width: 160, depth: 90, height: 82, color: '#a8b5a2', material: 'fabric' },
  { id: 'sofa-3', name: '3-seat sofa', category: 'sofa', width: 220, depth: 95, height: 82, color: '#a8b5a2', material: 'fabric' },
  { id: 'armchair', name: 'Armchair', category: 'sofa', width: 85, depth: 85, height: 85, color: '#d6b79a', material: 'fabric' },
  { id: 'chair-dining', name: 'Dining chair', category: 'chair', width: 45, depth: 50, height: 90, color: '#c9a77c', material: 'wood' },
  { id: 'chair-office', name: 'Office chair', category: 'chair', shape: 'round', width: 60, depth: 60, height: 100, color: '#4b5563', material: 'fabric' },
  { id: 'table-dining', name: 'Dining table', category: 'table', width: 160, depth: 90, height: 75, color: '#c9a77c', material: 'wood' },
  { id: 'table-round', name: 'Round table', category: 'table', shape: 'round', width: 110, depth: 110, height: 75, color: '#c9a77c', material: 'wood' },
  { id: 'table-coffee', name: 'Coffee table', category: 'table', width: 100, depth: 55, height: 42, color: '#b8946a', material: 'wood' },
  { id: 'table-side', name: 'Bedside table', category: 'table', width: 45, depth: 40, height: 50, color: '#b8946a', material: 'wood' },
  { id: 'desk', name: 'Desk', category: 'desk', width: 140, depth: 70, height: 75, color: '#e5e7eb', material: 'wood' },
  { id: 'desk-corner', name: 'Large desk', category: 'desk', width: 180, depth: 80, height: 75, color: '#e5e7eb', material: 'wood' },
  { id: 'wardrobe-2', name: 'Wardrobe 2-door', category: 'wardrobe', width: 100, depth: 58, height: 200, color: '#f3f4f6', material: 'matte' },
  { id: 'wardrobe-3', name: 'Wardrobe 3-door', category: 'wardrobe', width: 150, depth: 58, height: 200, color: '#f3f4f6', material: 'matte' },
  { id: 'dresser', name: 'Chest of drawers', category: 'wardrobe', width: 90, depth: 45, height: 100, color: '#d1d5db', material: 'wood' },
  { id: 'shelf-low', name: 'Low bookcase', category: 'shelf', width: 80, depth: 30, height: 80, color: '#e5e7eb', material: 'wood' },
  { id: 'shelf-tall', name: 'Tall bookcase', category: 'shelf', width: 80, depth: 30, height: 200, color: '#e5e7eb', material: 'wood' },
  { id: 'tv-unit', name: 'TV unit', category: 'tv', width: 160, depth: 40, height: 50, color: '#374151', material: 'matte' },
  { id: 'tv-unit-s', name: 'Small TV unit', category: 'tv', width: 120, depth: 40, height: 50, color: '#374151', material: 'matte' },
  { id: 'rug-s', name: 'Rug 140×200', category: 'rug', width: 140, depth: 200, height: 1, color: '#e7d9c4', material: 'fabric', flat: true },
  { id: 'rug-l', name: 'Rug 200×300', category: 'rug', width: 200, depth: 300, height: 1, color: '#e7d9c4', material: 'fabric', flat: true },
  { id: 'rug-round', name: 'Round rug', category: 'rug', shape: 'round', width: 160, depth: 160, height: 1, color: '#e7d9c4', material: 'fabric', flat: true },
  { id: 'lamp-floor', name: 'Floor lamp', category: 'lamp', shape: 'round', width: 35, depth: 35, height: 160, color: '#fde68a', material: 'metal' },
  { id: 'lamp-table', name: 'Table lamp', category: 'lamp', shape: 'round', width: 25, depth: 25, height: 40, color: '#fde68a', material: 'matte' },
  { id: 'plant-s', name: 'Small plant', category: 'plant', shape: 'round', width: 30, depth: 30, height: 60, color: '#86b383', material: 'matte' },
  { id: 'plant-l', name: 'Large plant', category: 'plant', shape: 'round', width: 50, depth: 50, height: 150, color: '#6a9c68', material: 'matte' },
];

export const SWATCHES = [
  '#e5e7eb', '#f3f4f6', '#374151', '#c7d2fe', '#a8b5a2', '#d6b79a',
  '#c9a77c', '#e7d9c4', '#fca5a5', '#fcd34d', '#86b383', '#93c5fd',
];

let counter = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function makeFurniture(c: CatalogItem, x: number, y: number): Furniture {
  return {
    id: uid('f'),
    name: c.name,
    category: c.category,
    shape: c.shape ?? 'box',
    x, y,
    width: c.width,
    depth: c.depth,
    height: c.height,
    rotation: 0,
    color: c.color,
    material: c.material ?? 'matte',
    locked: false,
    flat: !!c.flat,
  };
}
