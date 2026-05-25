import { describe, expect, test } from 'vitest';
import { Subject } from 'rxjs';
import * as THREE from 'three';

import { IIdentified } from '@wallandshadow/shared';
import { IToast } from '../../src/components/interfaces';
import { EditMode } from '../../src/components/MapControls.types';
import { Layer } from '../../src/models/interfaces';
import { MapUi, MapUiState } from './mapUi';

function createMapUi() {
  const states: MapUiState[] = [];
  const ui = new MapUi(
    undefined,
    state => states.push(state),
    () => new THREE.Vector3(),
    () => undefined,
    new Subject<IIdentified<IToast | undefined>>(),
  );
  return { ui, states };
}

describe('MapUi.keyUp image hotkey', () => {
  // Regression for the "I" hotkey bypassing the Basic-tier image gate. The
  // rest of the image UI (layer button, edit-mode button, context menu) is
  // gated on canUploadImages, but the hotkey only checked canDoAnything.
  // keyUp only reads `e.key`; a plain object is enough and avoids needing a DOM env.
  const iKeyEvent = { key: 'i' } as KeyboardEvent;

  test('Basic-tier user (canUploadImages=false) cannot enter image mode via I', () => {
    const { ui, states } = createMapUi();

    ui.keyUp(iKeyEvent, true, false);

    const last = states[states.length - 1];
    expect(last.layer).toBe(Layer.Object);
    expect(last.editMode).toBe(EditMode.Select);
  });

  test('Higher-tier user (canUploadImages=true) enters image mode via I', () => {
    const { ui, states } = createMapUi();

    ui.keyUp(iKeyEvent, true, true);

    const last = states[states.length - 1];
    expect(last.layer).toBe(Layer.Image);
    expect(last.editMode).toBe(EditMode.Image);
  });

  test('Player without edit rights (canDoAnything=false) cannot enter image mode via I', () => {
    const { ui, states } = createMapUi();

    ui.keyUp(iKeyEvent, false, true);

    const last = states[states.length - 1];
    expect(last.layer).toBe(Layer.Object);
    expect(last.editMode).toBe(EditMode.Select);
  });
});
