export type Role = 'none' | 'head' | 'body' | 'arm' | 'leg' | 'accessory';
export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'easeOutBack';
export type Tool = 'move' | 'rotate' | 'scale' | 'pivot';
export type Bg = 'checker' | 'white' | 'gray' | 'black';

export interface Transform {
  x: number;
  y: number;
  rotation: number; // degrees
  scaleX: number;
  scaleY: number;
}

export interface ImageRef {
  id: string;
  fileName: string;
  w: number;
  h: number;
}

export interface Variant {
  name: string;
  imageId: string | null;
  leftImageId: string | null;
}

export interface SpringCfg {
  enabled: boolean;
  stiffness: number;
  damping: number;
  delay: number; // ms
  maxRot: number; // deg
}

export interface Layer extends Transform {
  id: string;
  name: string;
  parentId: string | null;
  pivotX: number; // image-local px
  pivotY: number;
  visible: boolean;
  opacity: number;
  locked: boolean;
  role: Role;
  variants: Variant[];
  activeVariant: number;
  spring: SpringCfg;
}

export interface PoseEntry extends Transform {
  visible: boolean;
  opacity: number;
}

export interface Pose {
  id: string;
  name: string;
  data: Record<string, PoseEntry>;
}

export interface Keyframe extends Transform {
  frame: number;
  opacity: number;
  variant: number | null;
  ease: Ease; // easing toward the next key
}

export interface Clip {
  id: string;
  name: string;
  length: number; // frames
  loop: boolean;
  tracks: Record<string, Keyframe[]>;
  /** set on clips generated from a preset; only those may be regenerated in place */
  preset?: string;
}

export interface Doc {
  layers: Layer[]; // index 0 = bottom
  images: ImageRef[];
  poses: Pose[];
  clips: Clip[];
  activeClipId: string | null;
  facing: 'right' | 'left';
  flipMode: 'mirror' | 'spriteSet';
  fps: number;
}

export interface UI {
  selectedId: string | null;
  tool: Tool;
  zoom: number;
  panX: number;
  panY: number;
  bg: Bg;
  frame: number;
  playing: boolean;
  animate: boolean;
  selectedKey: { layerId: string; frame: number } | null;
  sq: number; // squash(+)/stretch(-) preview
  status: string;
}

export interface Eff extends Transform {
  opacity: number;
  visible: boolean;
  variant: number;
}
