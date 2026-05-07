// -----------------------------------------------------------------------
// Quick Pick
// -----------------------------------------------------------------------

Object.assign(GrooveDropper, {

    async loadQuickpickPresets() {
        try {
            const res = await fetch('/api/quickpick/presets');
            if (!res.ok) return;
            this.state.quickpick.presets = await res.json();
        } catch (e) { console.error(e); }
    },

    async loadQuickpickSlots(presetId) {
        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}/slots`);
            if (!res.ok) return;
            const data = await res.json();
            this.state.quickpick.slots = data.slots || {};
        } catch (e) { console.error(e); }
    },

    renderQuickpickBar() {
        this.renderQuickpickPresetSelect();
        this.renderQuickpickSlots();
    },

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
        this.elements.qpDeleteBtn.disabled = !hasActive;
    },

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

    _setFocusedQpSlot(slotNumber) {
        this.state.quickpick.focusedSlot = slotNumber;
        this.renderQuickpickSlots();
    },

    _clearFocusedQpSlot() {
        if (this.state.quickpick.focusedSlot === null) return;
        this.state.quickpick.focusedSlot = null;
        this.renderQuickpickSlots();
    },

    async _syncFocusedQpSlotPitch() {
        const slotNumber = this.state.quickpick.focusedSlot;
        if (slotNumber === null) return;
        const presetId = this.state.quickpick.activePresetId;
        if (!presetId) return;
        const slot = this.state.quickpick.slots[String(slotNumber)];
        if (!slot) return;
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
            if (!res.ok) return;
            const data = await res.json();
            this.state.quickpick.slots[String(slotNumber)] = data;
        } catch (e) { console.error(e); }
    },

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
            this.state.quickpick.activePresetId = preset.id;
            this.state.quickpick.slots = {};
            this.state.quickpick.focusedSlot = null;
            this.renderQuickpickBar();
            await this.saveConfig('quick-pick-preset', String(preset.id));
            this.showToast(`Preset "${preset.name}" created`);
        } catch (e) { console.error(e); }
    },

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

    async deleteQuickpickPreset() {
        const presetId = this.state.quickpick.activePresetId;
        if (!presetId) return;
        try {
            const res = await fetch(`/api/quickpick/presets/${presetId}`, { method: 'DELETE' });
            if (!res.ok) return;
            this.state.quickpick.presets = this.state.quickpick.presets.filter(p => p.id !== presetId);
            this.state.quickpick.activePresetId = null;
            this.state.quickpick.slots = {};
            this.state.quickpick.focusedSlot = null;
            this.renderQuickpickBar();
            await this.saveConfig('quick-pick-preset', '');
        } catch (e) { console.error(e); }
    },

    async saveQuickpickSlot(slotNumber) {
        if (!this.state.currentSampleId || !this.state.currentDigest) return;
        if (!this.state.quickpick.activePresetId) {
            await this.addQuickpickPreset();
            if (!this.state.quickpick.activePresetId) return;
        }
        if (this.state.quickpick.slots[String(slotNumber)]) {
            this.showToast(`Slot ${slotNumber} is already occupied, click on it to clear it first`);
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
            const data = await res.json();
            this.state.quickpick.slots[String(slotNumber)] = data;
            this.renderQuickpickSlots();
            this.showToast(`Slot ${slotNumber} saved to preset ${presetName}`);
        } catch (e) { console.error(e); }
    },

    async recallQuickpickSlot(slotNumber) {
        const presetId = this.state.quickpick.activePresetId;
        if (!presetId) { this.showToast('No quick pick preset selected'); return; }
        const preset = this.state.quickpick.presets.find(p => p.id === presetId);
        const presetName = preset ? preset.name : '?';
        const slot = this.state.quickpick.slots[String(slotNumber)];
        if (!slot) {
            this.showToast(`Slot ${slotNumber} is empty of quick pick preset ${presetName}`);
            return;
        }
        try {
            if (this.state.currentDigest === slot.digest) {
                // Same sample — just seek (and play if needed)
                this.state.originalStartOffset = slot.start_offset;
                this.state.currentOffset = slot.start_offset;
                this.state.pitchSemitones = slot.pitch_semitones;
                this.state.pitchCents = slot.pitch_cents;
                this._applyPitch();
                this._renderPitchOverlay();
                const shouldPlay = this.state.quickpick.playInstantly || this.state.isPlaying;
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
                this._pushHistory(data.history_id);
                this.updateUI(data, this.state.quickpick.playInstantly);
                this._renderPitchOverlay();
            }
        } catch (e) { console.error(e); }
    },

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
            this.showToast(`Slot ${slotNumber} deleted from quick pick preset ${presetName}`);
        } catch (e) { console.error(e); }
    },

    async storeToNextFreeQpSlot() {
        if (!this.state.currentSampleId || !this.state.currentDigest) return;

        for (let n = 1; n <= 10; n++) {
            const slot = this.state.quickpick.slots[String(n)];
            if (slot && slot.digest === this.state.currentDigest && slot.start_offset === this.state.originalStartOffset) {
                this.showToast(`Sample offset is already quick picked in slot ${n}`);
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
            const data = await res.json();
            this.state.quickpick.slots[String(freeSlot)] = data;
            this._setFocusedQpSlot(freeSlot);
            this.showToast(`Sample stored in quick slot ${freeSlot}`);
        } catch (e) { console.error(e); }
    },

});
