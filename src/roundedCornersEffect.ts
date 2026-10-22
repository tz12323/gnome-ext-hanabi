// Copyright (C) 2026 Jeff Shee <jeffshee8969@gmail.com> and contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

// Adapted from the Mutter project.
// See <https://gitlab.gnome.org/GNOME/mutter/-/blob/main/src/compositor/meta-background-content.c>.
const fragmentShaderDeclarations = [
    'uniform vec4 bounds;           // x, y: top left; z, w: bottom right     \n',
    'uniform float clip_radius;                                               \n',
    'uniform vec2 pixel_step;                                                 \n',
    'uniform float border_stroke;                                             \n',
    'uniform vec4 border_color;                                               \n',
    '                                                                         \n',
    'float                                                                    \n',
    'rounded_rect_coverage (vec2 p)                                           \n',
    '{                                                                        \n',
    '  float center_left  = bounds.x + clip_radius;                           \n',
    '  float center_right = bounds.z - clip_radius;                           \n',
    '  float center_x;                                                        \n',
    '                                                                         \n',
    '  if (p.x < center_left)                                                 \n',
    '    center_x = center_left;                                              \n',
    '  else if (p.x > center_right)                                           \n',
    '    center_x = center_right;                                             \n',
    '  else                                                                   \n',
    '    return 1.0; // The vast majority of pixels exit early here           \n',
    '                                                                         \n',
    '  float center_top    = bounds.y + clip_radius;                          \n',
    '  float center_bottom = bounds.w - clip_radius;                          \n',
    '  float center_y;                                                        \n',
    '                                                                         \n',
    '  if (p.y < center_top)                                                  \n',
    '    center_y = center_top;                                               \n',
    '  else if (p.y > center_bottom)                                          \n',
    '    center_y = center_bottom;                                            \n',
    '  else                                                                   \n',
    '    return 1.0;                                                          \n',
    '                                                                         \n',
    '  vec2 delta = p - vec2 (center_x, center_y);                            \n',
    '  float dist_squared = dot (delta, delta);                               \n',
    '                                                                         \n',
    '  // Fully outside the circle                                            \n',
    '  float outer_radius = clip_radius + 0.5;                                \n',
    '  if (dist_squared >= (outer_radius * outer_radius))                     \n',
    '    return 0.0;                                                          \n',
    '                                                                         \n',
    '  // Fully inside the circle                                             \n',
    '  float inner_radius = clip_radius - 0.5;                                \n',
    '  if (dist_squared <= (inner_radius * inner_radius))                     \n',
    '    return 1.0;                                                          \n',
    '                                                                         \n',
    '  // Only pixels on the edge of the curve need expensive antialiasing    \n',
    '  return outer_radius - sqrt (dist_squared);                             \n',
    '}                                                                        \n',
].join('');

const fragmentShaderCode = [
    'vec2 texture_coord;                                                      \n',
    '                                                                         \n',
    'texture_coord = cogl_tex_coord0_in.xy / pixel_step;                      \n',
    '                                                                         \n',
    'bool inside = texture_coord.x >= bounds.x && texture_coord.x <= bounds.z \n',
    '           && texture_coord.y >= bounds.y && texture_coord.y <= bounds.w;\n',
    '                                                                         \n',
    '// border stroke for debug purposes                                      \n',
    'bool on_border = border_stroke > 0.0 && inside && (                      \n',
    '    texture_coord.x < bounds.x + border_stroke ||                        \n',
    '    texture_coord.x > bounds.z - border_stroke ||                        \n',
    '    texture_coord.y < bounds.y + border_stroke ||                        \n',
    '    texture_coord.y > bounds.w - border_stroke);                         \n',
    '                                                                         \n',
    'if (on_border)                                                           \n',
    '    cogl_color_out = border_color;                                       \n',
    'else if (clip_radius > 0.0 && !inside)                                   \n',
    '    cogl_color_out = vec4 (0.0);                                         \n',
    'else if (clip_radius > 0.0)                                              \n',
    '    cogl_color_out *= rounded_rect_coverage (texture_coord);             \n',
].join('');

// GNOME 50 and 51 expose different ShaderEffect APIs:
// - GNOME 50: Shell.GLSLEffect with get_uniform_location()/vfunc_build_pipeline()
// - GNOME 51: Clutter.ShaderEffect with uniform names/vfunc_get_static_snippet()
const hasLegacyGLSLEffect = typeof (Shell as unknown as {GLSLEffect?: unknown}).GLSLEffect !== 'undefined';

type ShaderEffectWithUniforms = {
    set_uniform_float: (uniformOrName: number | string, nComponents: number, value: number[]) => void;
    get_uniform_location?: (name: string) => number;
};

interface RoundedCornersEffectApi {
    setBounds(bounds: number[]): void;
    setClipRadius(clipRadius: number): void;
    setPixelStep(pixelStep: number[]): void;
    setBorderStroke(stroke: number): void;
    setBorderColor(color: number[]): void;
}

type RoundedCornersEffectConstructor = new () => RoundedCornersEffectApi;

function setUniform(
    effect: ShaderEffectWithUniforms,
    name: string,
    nComponents: number,
    value: number[]
): void {
    if (hasLegacyGLSLEffect) {
        const location = effect.get_uniform_location!(name);
        effect.set_uniform_float(location, nComponents, value);
    } else {
        effect.set_uniform_float(name, nComponents, value);
    }
}

function setBounds(effect: ShaderEffectWithUniforms, bounds: number[]): void {
    setUniform(effect, 'bounds', 4, bounds);
}

function setClipRadius(effect: ShaderEffectWithUniforms, clipRadius: number): void {
    setUniform(effect, 'clip_radius', 1, [clipRadius]);
}

function setPixelStep(effect: ShaderEffectWithUniforms, pixelStep: number[]): void {
    setUniform(effect, 'pixel_step', 2, pixelStep);
}

function setBorderStroke(effect: ShaderEffectWithUniforms, stroke: number): void {
    setUniform(effect, 'border_stroke', 1, [stroke]);
}

function setBorderColor(effect: ShaderEffectWithUniforms, color: number[]): void {
    setUniform(effect, 'border_color', 4, color);
}

function createLegacyEffectClass(): RoundedCornersEffectConstructor {
    return class RoundedCornersEffect50 extends Shell.GLSLEffect {
        vfunc_build_pipeline(): void {
            this.add_glsl_snippet(
                Cogl.SnippetHook.FRAGMENT,
                fragmentShaderDeclarations,
                fragmentShaderCode,
                false
            );
        }

        setBounds(bounds: number[]): void {
            setBounds(this as unknown as ShaderEffectWithUniforms, bounds);
        }

        setClipRadius(clipRadius: number): void {
            setClipRadius(this as unknown as ShaderEffectWithUniforms, clipRadius);
        }

        setPixelStep(pixelStep: number[]): void {
            setPixelStep(this as unknown as ShaderEffectWithUniforms, pixelStep);
        }

        setBorderStroke(stroke: number): void {
            setBorderStroke(this as unknown as ShaderEffectWithUniforms, stroke);
        }

        setBorderColor(color: number[]): void {
            setBorderColor(this as unknown as ShaderEffectWithUniforms, color);
        }
    } as unknown as RoundedCornersEffectConstructor;
}

function createShaderEffectClass(): RoundedCornersEffectConstructor {
    return class RoundedCornersEffect51 extends Clutter.ShaderEffect {
        vfunc_get_static_snippet(): Cogl.Snippet {
            return Cogl.Snippet.new(
                Cogl.SnippetHook.FRAGMENT,
                fragmentShaderDeclarations,
                fragmentShaderCode
            );
        }

        setBounds(bounds: number[]): void {
            setBounds(this as unknown as ShaderEffectWithUniforms, bounds);
        }

        setClipRadius(clipRadius: number): void {
            setClipRadius(this as unknown as ShaderEffectWithUniforms, clipRadius);
        }

        setPixelStep(pixelStep: number[]): void {
            setPixelStep(this as unknown as ShaderEffectWithUniforms, pixelStep);
        }

        setBorderStroke(stroke: number): void {
            setBorderStroke(this as unknown as ShaderEffectWithUniforms, stroke);
        }

        setBorderColor(color: number[]): void {
            setBorderColor(this as unknown as ShaderEffectWithUniforms, color);
        }
    } as unknown as RoundedCornersEffectConstructor;
}

const RoundedCornersEffectBase = hasLegacyGLSLEffect
    ? createLegacyEffectClass()
    : createShaderEffectClass();

export const RoundedCornersEffect = GObject.registerClass(RoundedCornersEffectBase);

export type RoundedCornersEffect = InstanceType<typeof RoundedCornersEffect>;
