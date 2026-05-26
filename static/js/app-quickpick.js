// -----------------------------------------------------------------------
// Quick Pick
// -----------------------------------------------------------------------

Object.assign(GrooveDropper, {

    // Fetches all quickpick presets from the API and stores them in state.
    async loadQuickpickPresets() {
        try {
            const res = await fetch('/api/quickpick/presets');
            if (!res.ok) return;
            this.state.quickpick.presets = await res.json();
        } catch (e) { console.error(e); }
    },

    // Fetches slots for a given preset ID from the API and stores them in state.
    async loadQuickpickSlots(presetId) {
        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}/slots`);
            if (!res.ok) return;
            const data = await res.json();
            this.state.quickpick.slots = data.slots || {};
        } catch (e) { console.error(e); }
    },

    // Renders the full quickpick bar by delegating to the preset select and slot renderers.
    renderQuickpickBar() {
        this.renderQuickpickPresetSelect();
        this.renderQuickpickSlots();
    },

    // Rebuilds the preset <select> from state and enables/disables the rename and delete buttons
    // based on whether a preset is currently active.
    renderQuickpickPresetSelect() {
        const sel = this.elements.qpPresetSelect;
        sel.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— select preset —';
        sel.appendChild(placeholder);
        for (const preset of this.state.quickpick.presets) {
            const opt = document.createElement('option');
            opt.value = preset.id;
            opt.textContent = preset.name;
            sel.appendChild(opt);
        }
        sel.value = this.state.quickpick.activePresetId || '';
        const hasActive = !!this.state.quickpick.activePresetId;
        this.elements.qpRenameBtn.disabled = !hasActive;
        this.elements.qpCloneBtn.disabled = !hasActive;
        this.elements.qpDeleteBtn.disabled = !hasActive;
    },

    // Rebuilds the ten slot buttons (1–0), marking each as filled or focused based on state.
    // Clicking a filled slot deletes it; clicking an empty slot saves the current sample into it.
    renderQuickpickSlots() {
        const container = this.elements.qpSlots;
        container.innerHTML = '';
        for (const key of ['1','2','3','4','5','6','7','8','9','0']) {
            const slotNumber = key === '0' ? 10 : parseInt(key);
            const filled = !!this.state.quickpick.slots[String(slotNumber)];
            const focused = this.state.quickpick.focusedSlot === slotNumber;
            const btn = document.createElement('button');
            btn.className = 'qp-slot' + (filled ? ' filled' : '') + (focused ? ' focused' : '');
            btn.title = filled ? `Slot ${slotNumber} — click to delete` : `Slot ${slotNumber} — empty`;
            const digit = document.createElement('span');
            digit.textContent = key;
            btn.appendChild(digit);
            btn.addEventListener('click', () => {
                if (filled) this.deleteQuickpickSlot(slotNumber).catch(e => console.error(e));
                else {
                    this.saveQuickpickSlot(slotNumber).catch(e => console.error(e));
                    this._setFocusedQpSlot(slotNumber);
                }
            });
            container.appendChild(btn);
        }
    },

    // Switches the active quick-pick preset: clears the slot map and focused slot so the
    // old preset's data can't bleed through while the new preset's slots load.
    _resetQuickpickState(presetId) {
        this.state.quickpick.activePresetId = presetId;
        this.state.quickpick.slots = {};
        this.state.quickpick.focusedSlot = null;
    },

    // Marks the given slot as focused in state and re-renders the slot buttons.
    _setFocusedQpSlot(slotNumber) {
        this.state.quickpick.focusedSlot = slotNumber;
        this.renderQuickpickSlots();
    },

    // Clears the focused slot in state and re-renders the slot buttons; no-ops if nothing is focused.
    _clearFocusedQpSlot() {
        if (this.state.quickpick.focusedSlot === null) return;
        this.state.quickpick.focusedSlot = null;
        this.renderQuickpickSlots();
    },

    // PUTs the current pitch (semitones + cents) to the focused slot's API endpoint,
    // updating state with the server response. No-ops if there is no focused slot or active preset.
    async _syncFocusedQpSlotPitch() {
        const slotNumber = this.state.quickpick.focusedSlot;
        if (slotNumber === null)
            return;

        const presetId = this.state.quickpick.activePresetId;
        const slot = this.state.quickpick.slots[String(slotNumber)];
        if (!presetId || !slot)
            return;

        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}/slots/${slotNumber}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    digest: slot.digest,
                    start_offset: slot.start_offset,
                    pitch_semitones: this.state.pitchSemitones,
                    pitch_cents: this.state.pitchCents,
                }),
            });

            if (!res.ok)
                return;

            this.state.quickpick.slots[String(slotNumber)] = await res.json();
        } catch (e) { console.error(e); }
    },

    // Navigates to the next (direction=1) or previous (direction=-1) filled slot, wrapping
    // circularly. Shows a toast if fewer than 2 slots are filled.
    navigateQuickpickSlot(direction) {
        const filled = [1,2,3,4,5,6,7,8,9,10].filter(n => !!this.state.quickpick.slots[String(n)]);
        if (filled.length < 2) {
            this.showToast('No other slots available to scroll through');
            return;
        }
        const current = this.state.quickpick.focusedSlot;
        let idx = current !== null ? filled.indexOf(current) : -1;
        if (idx === -1) idx = direction === 1 ? filled.length - 1 : 0;
        const next = filled[(idx + direction + filled.length) % filled.length];
        this._setFocusedQpSlot(next);
        this.recallQuickpickSlot(next).catch(e => console.error(e));
    },

    // POSTs to clone the active preset (slots included) to a new timestamped preset,
    // switches to it, and shows a toast naming both source and clone.
    async cloneQuickpickPreset() {
        const presetId = this.state.quickpick.activePresetId;
        if (!presetId) return;
        try {
            const res = await fetch('/api/quickpick/clone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset_id: presetId }),
            });

            if (!res.ok)
                return;

            const data = await res.json();
            // Register clone as active; slots stay populated (loadQuickpickSlots overwrites them next).
            this.state.quickpick.presets.push({ id: data.id, name: data.name });
            this.state.quickpick.activePresetId = data.id;
            this.state.quickpick.focusedSlot = null;

            await this.loadQuickpickSlots(data.id);
            this.renderQuickpickBar();
            await this.saveConfig('quick-pick-preset', String(data.id));
            this.showToast(`Cloned quick pick '${data.source_name}' to '${data.name}'`);
        } catch (e) { console.error(e); }
    },

    // POSTs to create a new preset, sets it as active, clears slots, and persists the
    // selection to config. Shows a toast with the new preset name on success.
    async addQuickpickPreset() {
        this.elements.qpAddBtn.blur();
        try {
            const res = await fetch('/api/quickpick/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (!res.ok) return;
            const preset = await res.json();
            this.state.quickpick.presets.push(preset);
            this._resetQuickpickState(preset.id);
            this.renderQuickpickBar();
            await this.saveConfig('quick-pick-preset', String(preset.id));
            this.showToast(`Quick pick preset '"${preset.name}"' created`);
        } catch (e) { console.error(e); }
    },

    // Replaces the preset <select> with an inline text input for renaming the active preset.
    // Commits on Enter or blur; cancels on Escape.
    startQuickpickRename() {
        const active = this.state.quickpick.presets.find(p => p.id === this.state.quickpick.activePresetId);
        if (!active) return;

        const sel = this.elements.qpPresetSelect;
        const renameBtn = this.elements.qpRenameBtn;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'qp-rename-input';
        input.value = active.name;

        sel.style.display = 'none';
        renameBtn.style.display = 'none';
        sel.parentElement.insertBefore(input, sel);
        input.focus();
        input.select();

        let committed = false;

        const commit = async () => {
            if (committed) return;
            committed = true;
            const name = input.value.trim();
            input.remove();
            sel.style.display = '';
            renameBtn.style.display = '';
            if (name && name !== active.name) await this.renameQuickpickPreset(name);
        };

        const cancel = () => {
            if (committed) return;
            committed = true;
            input.remove();
            sel.style.display = '';
            renameBtn.style.display = '';
        };

        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            e.stopPropagation();
        });
        input.addEventListener('blur', cancel);
    },

    // PATCHes the active preset with a new name and updates it in state and the UI.
    async renameQuickpickPreset(name) {
        const presetId = this.state.quickpick.activePresetId;
        if (!presetId || !name) return;
        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!res.ok) return;
            const data = await res.json();
            const preset = this.state.quickpick.presets.find(p => p.id === presetId);
            if (preset) preset.name = data.name;
            this.renderQuickpickPresetSelect();
        } catch (e) { console.error(e); }
    },

    // DELETEs the active preset via the API, resets all quickpick state, and clears the
    // persisted config selection.
    async deleteQuickpickPreset() {
        const presetId = this.state.quickpick.activePresetId;
        if (!presetId) return;
        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}`, { method: 'DELETE' });
            if (!res.ok) return;
            this.state.quickpick.presets = this.state.quickpick.presets.filter(p => p.id !== presetId);
            this._resetQuickpickState(null);
            this.renderQuickpickBar();
            await this.saveConfig('quick-pick-preset', '');
        } catch (e) { console.error(e); }
    },

    // PUTs the current sample digest, start offset, and pitch into the given slot number.
    // Auto-creates a new preset if none is active; shows a toast on success or if the slot is occupied.
    async saveQuickpickSlot(slotNumber) {
        if (!this.state.currentSampleId || !this.state.currentDigest) return;
        if (!this.state.quickpick.activePresetId) {
            await this.addQuickpickPreset();
            if (!this.state.quickpick.activePresetId) return;
        }
        if (this.state.quickpick.slots[String(slotNumber)]) {
            this.showToast(`Slot ${slotNumber} is already occupied (click on it to clear it first)`);
            return;
        }
        const presetId = this.state.quickpick.activePresetId;
        const preset = this.state.quickpick.presets.find(p => p.id === presetId);
        const presetName = preset ? preset.name : '?';
        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}/slots/${slotNumber}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    digest: this.state.currentDigest,
                    start_offset: this.state.originalStartOffset,
                    pitch_semitones: this.state.pitchSemitones,
                    pitch_cents: this.state.pitchCents,
                }),
            });
            if (!res.ok) return;
            this.state.quickpick.slots[String(slotNumber)] = await res.json();
            this.renderQuickpickSlots();
            this.showToast(`Slot ${slotNumber} saved to quick pick '${presetName}'`);
        } catch (e) { console.error(e); }
    },

    // Recalls a saved slot: seeks in place (preserving playback state) if the digest matches the
    // current sample, or performs a full sample load otherwise. Applies stored pitch on recall.
    async recallQuickpickSlot(slotNumber) {
        const presetId = this.state.quickpick.activePresetId;
        if (!presetId) { this.showToast('No quick pick preset selected'); return; }
        const preset = this.state.quickpick.presets.find(p => p.id === presetId);
        const presetName = preset ? preset.name : '?';
        const slot = this.state.quickpick.slots[String(slotNumber)];
        if (!slot) {
            this.showToast(`Slot ${slotNumber} is empty of quick pick preset '${presetName}'`);
            return;
        }
        try {
            if (this.state.currentDigest === slot.digest) {
                // Same sample — just seek (and play if needed)
                // All four fields move together: offset pair anchors the loop point; pitch pair
                // must match so _applyPitch and _renderPitchOverlay reflect the slot's tuning.
                this._setOriginOffset(slot.start_offset);
                this.state.currentOffset = slot.start_offset;
                this.state.pitchSemitones = slot.pitch_semitones;
                this.state.pitchCents = slot.pitch_cents;
                this._applyPitch();
                this._renderPitchOverlay();
                const shouldPlay = this.state.playInstantly || this.state.isPlaying;
                this.state.skipEndedEvent = true;
                this.elements.audio.pause();
                this.elements.audio.currentTime = slot.start_offset / this.state.sampleRate;
                this.updateOffsetDisplay(slot.start_offset);
                this.updatePlayhead();
                this.flashPlayhead();
                if (shouldPlay) {
                    this.elements.audio.play();
                    if (!this.state.isPlaying) {
                        this.state.isPlaying = true;
                        this.updateStatusText('PLAYING');
                        this._startPlayheadUpdater();
                    }
                }
                setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
            } else {
                // Different sample — full load
                this.state.pitchSemitones = slot.pitch_semitones;
                this.state.pitchCents = slot.pitch_cents;
                const res = await fetch(`/api/sample/digest/${slot.digest}?start=${slot.start_offset}`);
                if (!res.ok) { this.showErrorToast('Sample not found'); return; }
                const data = await res.json();
                this._pushHistory(data);
                this.updateUI(data, this.state.playInstantly);
                this._renderPitchOverlay();
            }
        } catch (e) { console.error(e); }
    },

    // DELETEs the given slot from the active preset, removes it from state, and clears
    // the focused slot if it was the deleted one.
    async deleteQuickpickSlot(slotNumber) {
        const presetId = this.state.quickpick.activePresetId;
        if (!presetId) return;
        const preset = this.state.quickpick.presets.find(p => p.id === presetId);
        const presetName = preset ? preset.name : '?';
        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}/slots/${slotNumber}`, { method: 'DELETE' });
            if (!res.ok) return;
            delete this.state.quickpick.slots[String(slotNumber)];
            if (this.state.quickpick.focusedSlot === slotNumber) {
                this.state.quickpick.focusedSlot = null;
            }
            this.renderQuickpickSlots();
            this.showToast(`Slot ${slotNumber} deleted from quick pick preset '${presetName}'`);
        } catch (e) { console.error(e); }
    },

    // Saves the current sample to the first free slot (1–10), skipping if the sample/offset is
    // already present in any slot. Auto-creates a preset if needed; focuses the newly filled slot.
    async storeToNextFreeQpSlot() {
        if (!this.state.currentSampleId || !this.state.currentDigest) return;

        for (let n = 1; n <= 10; n++) {
            const slot = this.state.quickpick.slots[String(n)];
            if (slot && slot.digest === this.state.currentDigest && slot.start_offset === this.state.originalStartOffset) {
                this.showToast(`Sample offset is already present in slot ${n}`);
                return;
            }
        }

        let freeSlot = null;
        for (let n = 1; n <= 10; n++) {
            if (!this.state.quickpick.slots[String(n)]) { freeSlot = n; break; }
        }
        if (freeSlot === null) {
            this.showToast('No more free slots to quick pick');
            return;
        }

        if (!this.state.quickpick.activePresetId) {
            await this.addQuickpickPreset();
            if (!this.state.quickpick.activePresetId) return;
        }

        const presetId = this.state.quickpick.activePresetId;
        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}/slots/${freeSlot}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    digest: this.state.currentDigest,
                    start_offset: this.state.originalStartOffset,
                    pitch_semitones: this.state.pitchSemitones,
                    pitch_cents: this.state.pitchCents,
                }),
            });
            if (!res.ok) return;
            this.state.quickpick.slots[String(freeSlot)] = await res.json();
            this._setFocusedQpSlot(freeSlot);
            this.showToast(`Sample stored in slot ${freeSlot}`);
        } catch (e) { console.error(e); }
    },

});
