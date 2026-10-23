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
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Graphene from 'gi://Graphene';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Logger} from './logger.js';
import {RoundedCornersEffect} from './roundedCornersEffect.js';
import {APPLICATION_ID} from './constants.js';

const logger = new Logger('wallpaper');
// Ref: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/layout.js
const BACKGROUND_FADE_ANIMATION_TIME = 1000;
// Interval for polling until the renderer window appears (ms).
const RENDERER_POLL_INTERVAL_MS = 1000;
// Blur My Shell's static blur keeps its last sampled texture. Refresh the
// dock/panel inputs at a low rate so they follow the video without rendering
// the full wallpaper pipeline at video frame rate.
const SAMPLE_REFRESH_INTERVAL_MS = 100;

// A Blur My Shell static-blur sampling container we mirror the live frame into.
interface SampleTarget {
    clone: Clutter.Clone | null;
    destroyId: number;
    // Re-raises our clone when BMS adds a replacement Meta.BackgroundActor.
    childAddedId: number;
    // Coalesces deferred re-raise requests (0 = none pending).
    raiseSourceId: number;
    refreshId: number;
}

export const LiveWallpaper = GObject.registerClass(
    class LiveWallpaper extends St.Widget {
        // Background actor we sit on, and values derived from it.
        private backgroundActor: Meta.BackgroundActor;
        // Meta.BackgroundGroup normally, or an St.Widget (with style_class) on the lock screen.
        private metaBackgroundGroup: Clutter.Actor | null;
        private monitorIndex: number;

        // Injected dependencies.
        private settings: Gio.Settings;
        // Returns all window actors unfiltered (renderer windows are hidden from the
        // public get_window_actors by GnomeShellOverride); injected so getRenderer can find them.
        private getWindowActors: () => Meta.WindowActor[];

        // Lifecycle bookkeeping, cleaned up on destroy.
        private isDisposed = false;
        private rendererPollTimeoutId = 0;
        private settingsChangedIds: number[] = [];

        // The wallpaper clone and its source-destroy handler.
        private wallpaper: Clutter.Clone | null = null;
        private sourceDestroyId: number | null = null;
        // Containers created by Blur My Shell for static panel/dock blur. They need
        // a live clone so their samples use the video instead of the static wallpaper.
        private sampleTargets = new Map<Clutter.Actor, SampleTarget>();

        // Rendering effect and monitor geometry, set up in the constructor.
        private roundedCornersEffect!: RoundedCornersEffect;
        private display!: Meta.Display;
        private monitorScale!: number;
        private monitorWidth!: number;
        private monitorHeight!: number;

        constructor(
            backgroundActor: Meta.BackgroundActor,
            settings: Gio.Settings,
            getWindowActors: () => Meta.WindowActor[]
        ) {
            super({
                // Fill the background actor's allocation. The overview shrinks the
                // workspace to a small preview in the app-grid state; without FILL the
                // clone keeps its monitor-sized allocation and is painted as a small
                // cropped rectangle in the top-left corner.
                layout_manager: new Clutter.BinLayout(),
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                width: backgroundActor.width,
                height: backgroundActor.height,
                x_expand: true,
                y_expand: true,
                opacity: 0,
            });
            this.backgroundActor = backgroundActor;
            this.metaBackgroundGroup = backgroundActor.get_parent();
            this.monitorIndex = this.backgroundActor.monitor;
            this.settings = settings;
            this.getWindowActors = getWindowActors;

            this.connect('destroy', () => {
                this.isDisposed = true;
                if (this.rendererPollTimeoutId) {
                    GLib.source_remove(this.rendererPollTimeoutId);
                    this.rendererPollTimeoutId = 0;
                }
                for (const id of this.settingsChangedIds)
                    this.settings.disconnect(id);
                this.settingsChangedIds = [];
                if (this.wallpaper) {
                    if (this.sourceDestroyId) {
                        this.wallpaper.source?.disconnect(this.sourceDestroyId);
                        this.sourceDestroyId = null;
                    }
                    this.wallpaper.set_source(null);
                    this.wallpaper.destroy();
                    this.wallpaper = null;
                }
                this.destroySampleTargets();
            });

            this.display = this.backgroundActor.meta_display;
            this.monitorScale = this.display.get_monitor_scale(this.monitorIndex);
            const {width, height} = Main.layoutManager.monitors[this.monitorIndex];
            this.monitorWidth = width;
            this.monitorHeight = height;

            backgroundActor.layout_manager = new Clutter.BinLayout();
            backgroundActor.add_child(this);

            this.roundedCornersEffect = new RoundedCornersEffect();
            this.backgroundActor.add_effect(this.roundedCornersEffect);

            this.setPixelStep(this.monitorWidth, this.monitorHeight);
            this.setRoundedClipRadius(0.0);
            this.setBorderStroke(0);
            this.setBorderColor([1.0, 0.0, 0.0, 1.0]);

            this.settingsChangedIds.push(
                this.settings.connect('changed::border-stroke', () => {
                    this.setBorderStroke(this.settings.get_int('border-stroke') * this.monitorScale);
                    this.backgroundActor?.queue_redraw();
                })
            );
            for (const key of ['bounds-inset-x1', 'bounds-inset-y1', 'bounds-inset-x2', 'bounds-inset-y2']) {
                this.settingsChangedIds.push(
                    this.settings.connect(`changed::${key}`, () => {
                        this.applyBounds();
                        this.backgroundActor?.queue_redraw();
                    })
                );
            }
            this.setRoundedClipBounds(0, 0, this.monitorWidth, this.monitorHeight);

            this.connect('notify::allocation', () => {
                if (this.isDisposed)
                    return;
                try {
                    if (this.width <= 0 || this.height <= 0)
                        return;
                    // The overview can allocate the workspace background at a
                    // fraction of the monitor size (the small workspace preview in
                    // the app grid). Keep the shader's pixel step and bounds in
                    // sync with the current allocation instead of the monitor size.
                    this.setPixelStep(this.width, this.height);
                    this.applyBounds();
                    this.roundedCornersEffect.setBorderStroke(
                        this.settings.get_int('border-stroke') * this.monitorScale
                    );
                    this.backgroundActor?.queue_redraw();
                } catch (e) {
                    logError(e as object, 'LiveWallpaper notify::allocation');
                }
            });

            this.applyWallpaper();
        }

        isLockScreen(): boolean {
            const group = this.metaBackgroundGroup as (Clutter.Actor & { style_class?: string }) | null;
            return group?.style_class?.includes('screen-shield-background') ?? false;
        }

        private applyBounds(): void {
            if (this.isDisposed)
                return;
            const workArea = Main.layoutManager.getWorkAreaForMonitor(this.monitorIndex);
            const monitor = Main.layoutManager.monitors[this.monitorIndex];
            const panelOffset = (workArea.y - monitor.y) / monitor.height * this.backgroundActor.height;
            const ix1 = this.settings.get_int('bounds-inset-x1');
            const iy1 = this.settings.get_int('bounds-inset-y1');
            const ix2 = this.settings.get_int('bounds-inset-x2');
            const iy2 = this.settings.get_int('bounds-inset-y2');
            this.roundedCornersEffect.setBounds(
                [ix1, panelOffset + iy1, this.width - ix2, this.height - iy2]
                    .map(e => e * this.monitorScale)
            );
        }

        setPixelStep(width: number, height: number): void {
            if (this.isDisposed)
                return;
            this.roundedCornersEffect.setPixelStep([
                1.0 / (width * this.monitorScale),
                1.0 / (height * this.monitorScale),
            ]);
        }

        setRoundedClipRadius(radius: number): void {
            if (this.isDisposed)
                return;
            this.roundedCornersEffect.setClipRadius(radius * this.monitorScale);
        }

        setRoundedClipBounds(x1: number, y1: number, x2: number, y2: number): void {
            if (this.isDisposed)
                return;
            this.roundedCornersEffect.setBounds(
                [x1, y1, x2, y2].map(e => e * this.monitorScale)
            );
        }

        setBorderStroke(stroke: number): void {
            if (this.isDisposed)
                return;
            this.roundedCornersEffect.setBorderStroke(stroke);
        }

        setBorderColor(color: number[]): void {
            if (this.isDisposed)
                return;
            this.roundedCornersEffect.setBorderColor(color);
        }

        // Include the live wallpaper in Blur My Shell's static sampling container.
        // The sample container is cloned and blurred by BMS, so adding our clone
        // here makes the panel/dock sample follow the video without touching the
        // primary Meta.BackgroundActor created by the shell.
        addSampleTarget(container: Clutter.Actor): void {
            if (this.isDisposed || this.sampleTargets.has(container))
                return;

            const target: SampleTarget = {
                clone: null,
                destroyId: 0,
                childAddedId: 0,
                raiseSourceId: 0,
                refreshId: 0,
            };

            target.destroyId = container.connect('destroy', () => {
                // The container is being disposed; don't disconnect this handler.
                target.destroyId = 0;
                this.destroySampleTarget(container, target);
            });

            // Blur My Shell replaces its Meta.BackgroundActor after a background
            // change (and adds it above our clone), which would hide the live frame
            // behind the static wallpaper again. Re-raise our clone whenever the
            // sampling container gains a child.
            target.childAddedId = container.connect('child-added', () => {
                this.queueSampleTargetRaise(container, target);
            });

            this.sampleTargets.set(container, target);
            this.ensureSampleRefresh(container, target);
            this.syncSampleTargets();
        }

        private ensureSampleRefresh(container: Clutter.Actor, target: SampleTarget): void {
            if (target.refreshId || this.isDisposed)
                return;

            // Blur My Shell's static blur keeps its last sampled texture and only
            // refreshes when its input is damaged. A video surface does not damage
            // its parent, so keep the sample input dirty. This is needed for the
            // panel too, not only the dock: both can use BMS static blur.
            target.refreshId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                SAMPLE_REFRESH_INTERVAL_MS,
                () => {
                    if (this.isDisposed)
                        return GLib.SOURCE_REMOVE;

                    const clone = target.clone;
                    if (!clone) {
                        // Keep polling: the renderer window may not have appeared
                        // yet, and the clone is created after it does.
                        return GLib.SOURCE_CONTINUE;
                    }

                    this.raiseSampleClone(container, target);
                    this.queueSampleTargetDamage(container, clone);
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }

        private queueSampleTargetRaise(container: Clutter.Actor, target: SampleTarget): void {
            if (target.raiseSourceId || this.isDisposed)
                return;

            target.raiseSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                target.raiseSourceId = 0;
                this.raiseSampleClone(container, target);
                return GLib.SOURCE_REMOVE;
            });
        }

        private raiseSampleClone(container: Clutter.Actor, target: SampleTarget): void {
            const clone = target.clone;
            if (!clone || this.isDisposed)
                return;
            if (clone.get_parent() === container && container.get_last_child() !== clone)
                container.set_child_above_sibling(clone, null);
        }

        private queueSampleTargetDamage(container: Clutter.Actor, clone: Clutter.Clone): void {
            clone.queue_redraw();
            // Dash to Dock can stay mapped to the old damage region. Force the
            // full sample allocation dirty as well.
            clone.queue_redraw_with_clip(null);

            // The BMS blur effect lives on an ancestor of the sampling container,
            // not on the container itself; walk up and invalidate it.
            let actor: Clutter.Actor | null = container;
            for (let i = 0; actor && i < 4; i++) {
                actor.queue_redraw();
                actor.get_effects().forEach(effect => effect.queue_repaint());
                actor = actor.get_parent();
            }
        }

        private syncSampleTargets(): void {
            if (this.isDisposed || !this.wallpaper)
                return;

            for (const [container, target] of this.sampleTargets) {
                if (target.clone)
                    continue;

                // Clone the renderer actor directly instead of the main clone:
                // the main clone is resized to the workspace allocation (which is
                // small in the app-grid state), while the blur sample must always
                // stay at full monitor resolution.
                const source = this.wallpaper.source ?? this.wallpaper;
                const clone = new Clutter.Clone({
                    source,
                    width: this.monitorWidth,
                    height: this.monitorHeight,
                });
                container.add_child(clone);
                // Meta.BackgroundActor is kept at the bottom by BMS; put the live
                // frame above it so the sample is not a composite of both images.
                container.set_child_above_sibling(clone, null);
                target.clone = clone;
                this.ensureSampleRefresh(container, target);
            }
        }

        private clearSampleClones(): void {
            for (const target of this.sampleTargets.values()) {
                target.clone?.destroy();
                target.clone = null;
            }
        }

        // Detach the live frame from a BMS sampling container (used when another
        // LiveWallpaper becomes the preferred sample source for this monitor).
        removeSampleTarget(container: Clutter.Actor): void {
            const target = this.sampleTargets.get(container);
            if (target)
                this.destroySampleTarget(container, target);
        }

        private destroySampleTarget(container: Clutter.Actor, target: SampleTarget): void {
            if (target.refreshId) {
                GLib.source_remove(target.refreshId);
                target.refreshId = 0;
            }
            if (target.raiseSourceId) {
                GLib.source_remove(target.raiseSourceId);
                target.raiseSourceId = 0;
            }

            try {
                if (target.childAddedId)
                    container.disconnect(target.childAddedId);
                if (target.destroyId)
                    container.disconnect(target.destroyId);
            } catch {
                // The container may already be partly disposed.
            }
            target.childAddedId = 0;
            target.destroyId = 0;

            target.clone?.destroy();
            target.clone = null;
            this.sampleTargets.delete(container);
        }

        private destroySampleTargets(): void {
            for (const [container, target] of [...this.sampleTargets])
                this.destroySampleTarget(container, target);
            this.sampleTargets.clear();
        }

        private applyWallpaper(): void {
            if (this.isDisposed)
                return;
            logger.debug('Applying wallpaper...');
            const operation = (): boolean => {
                if (this.isDisposed) {
                    logger.debug('LiveWallpaper disposed, stopping wallpaper operation');
                    return false;
                }

                const renderer = this.getRenderer();
                if (renderer) {
                    this.wallpaper = new Clutter.Clone({
                        source: renderer,
                        pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
                        // Scale the clone to the LiveWallpaper allocation instead of
                        // keeping it at the renderer's monitor size. The overview
                        // allocates the workspace background at a fraction of the
                        // monitor size in the app-grid state.
                        x_expand: true,
                        y_expand: true,
                        x_align: Clutter.ActorAlign.FILL,
                        y_align: Clutter.ActorAlign.FILL,
                    });
                    this.wallpaper.connect('destroy', () => {
                        this.wallpaper = null;
                        this.clearSampleClones();
                    });
                    this.sourceDestroyId = this.wallpaper.source!.connect(
                        'destroy',
                        () => {
                            if (this.wallpaper)
                                this.wallpaper.destroy();
                            if (!this.isDisposed)
                                this.applyWallpaper();
                        }
                    );
                    this.add_child(this.wallpaper);
                    this.syncSampleTargets();
                    this.fade();
                    logger.debug('Wallpaper applied');
                    this.rendererPollTimeoutId = 0;
                    return false;
                } else {
                    return true;
                }
            };

            if (operation()) {
                this.rendererPollTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    RENDERER_POLL_INTERVAL_MS,
                    operation
                );
            }
        }

        private getRenderer(): Clutter.Actor | null {
            // Renderer windows are hidden from the public get_window_actors, so use the
            // injected unfiltered accessor to find them.
            const hanabiWindowActors = this.getWindowActors().filter(
                actor => actor.meta_window?.title?.includes(APPLICATION_ID)
            );

            const numMonitors = global.display.get_n_monitors();
            if (hanabiWindowActors.length < numMonitors) {
                logger.debug(
                    `Hanabi windows (${hanabiWindowActors.length}) < monitors (${numMonitors}), rejecting`
                );
                return null;
            }

            const monitorIndices = hanabiWindowActors.map(actor => actor.meta_window!.get_monitor());
            const uniqueMonitorIndices = new Set(monitorIndices);
            if (uniqueMonitorIndices.size !== monitorIndices.length) {
                logger.debug('Non-unique monitor indices detected, rejecting');
                return null;
            }

            const monitorIndex = this.backgroundActor.monitor;
            const renderer = hanabiWindowActors.find(
                actor => actor.meta_window!.get_monitor() === monitorIndex
            );

            if (!renderer) {
                logger.debug(
                    `No renderer found for monitor ${monitorIndex}. Found actors for monitors: ${monitorIndices}`
                );
            }

            return renderer ?? null;
        }

        private fade(visible = true): void {
            if (this.isDisposed)
                return;
            this.ease({
                opacity: visible ? 255 : 0,
                duration: BACKGROUND_FADE_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }
);

export type LiveWallpaper = InstanceType<typeof LiveWallpaper>;
