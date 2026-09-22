import { analyse, type Frame } from '../visualizer/analysis';
import type { AudioData } from '../audio/buffer';
import { mixProject, type AudioSourceLookup } from './mixdown';
import type { VideoProject } from './project';

/**
 * El golpe al ritmo: el mismo pulso de graves que mueve el visualizador,
 * disponible como efecto en el editor de vídeo.
 *
 * Se reutiliza `analyse()` en lugar de escribir otro analizador. Eso no es solo
 * ahorro: garantiza que un clip y un visualizador hechos con el mismo audio
 * laten exactamente igual, que es lo que alguien espera al montarlos juntos.
 *
 * El análisis se hace entero por adelantado, nunca en vivo, por la misma razón
 * que en el visualizador: la exportación tiene que dar el mismo resultado cada
 * vez, y un analizador en tiempo real depende de cuándo llegó cada fotograma.
 */

/** Resolución del análisis. Más que los fps de cualquier proyecto razonable. */
const BEAT_FPS = 60;

export interface BeatTrack {
  readonly fps: number;
  /** Energía de graves por fotograma, 0–1. */
  readonly bass: Float32Array;
}

export const EMPTY_BEAT: BeatTrack = { fps: BEAT_FPS, bass: new Float32Array(0) };

/** ¿Hay algún clip que lata? Si no, no vale la pena analizar nada. */
export function projectUsesBeat(project: VideoProject): boolean {
  return project.tracks.some((track) => track.clips.some((clip) => clip.beatPunch > 0));
}

/** Analiza un audio ya mezclado. El exportador ya tiene la mezcla hecha. */
export function analyseAudioBeat(audio: AudioData): BeatTrack {
  const frames: Frame[] = analyse(audio, {
    fftSize: 2048,
    fps: BEAT_FPS,
    // Poco suavizado: un golpe tiene que sonar a golpe, no a marea.
    smoothing: 0.3,
    bands: 32,
    minFrequency: 20,
    maxFrequency: 16000,
  });

  const bass = new Float32Array(frames.length);
  for (let i = 0; i < frames.length; i += 1) bass[i] = frames[i]?.bass ?? 0;
  return { fps: BEAT_FPS, bass };
}

/** Analiza la mezcla del proyecto. Caro: conviene guardarlo. */
export function analyseProjectBeat(project: VideoProject, lookup: AudioSourceLookup): BeatTrack {
  return analyseAudioBeat(mixProject(project, lookup).audio);
}

/**
 * Energía de graves en un instante, interpolada entre fotogramas del análisis.
 *
 * Sin interpolar, un proyecto a 24 fps contra un análisis a 60 daría saltos
 * visibles: el mismo valor repetido dos fotogramas y luego un brinco.
 */
export function bassAt(track: BeatTrack, seconds: number): number {
  const { bass, fps } = track;
  if (bass.length === 0) return 0;
  const position = Math.max(0, seconds * fps);
  const index = Math.floor(position);
  if (index >= bass.length - 1) return bass[bass.length - 1] ?? 0;
  const mix = position - index;
  return (bass[index] ?? 0) * (1 - mix) + (bass[index + 1] ?? 0) * mix;
}

/**
 * Cuánto se agranda el clip en este instante.
 *
 * El 0,18 es el mismo factor que usa el visualizador, para que el efecto se
 * reconozca como el mismo. A fuerza 1 el clip crece un 18 % en el golpe más
 * fuerte, que es notorio sin llegar a marear.
 */
export function punchScale(strength: number, bass: number): number {
  if (strength <= 0) return 1;
  return 1 + bass * strength * 0.18;
}
