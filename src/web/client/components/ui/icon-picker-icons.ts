import type { ComponentType } from 'react';
import * as MdIcons from 'react-icons/md';

type IconComponent = ComponentType<{ className?: string; size?: string | number }>;

const ICON_MAP = MdIcons as Record<string, IconComponent>;

export const MATERIAL_ICON_NAMES = Object.keys(ICON_MAP)
  .filter((name) => name.startsWith('Md') && name !== 'Md')
  .sort((a, b) => a.localeCompare(b));

export function resolveMaterialIcon(name: string): IconComponent {
  return ICON_MAP[name] ?? ICON_MAP['MdCategory'] ?? MdIcons.MdCategory;
}
