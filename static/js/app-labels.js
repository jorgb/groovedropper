Object.assign(GrooveDropper, {

    async _doRefresh() {
        try {
            const res = await fetch('/api/samples/refresh', { method: 'POST' });
            const data = await res.json();
            if (res.status === 409 && data.error === 'scan_in_progress') {
                this.showToast('A scan is already running — wait for it to finish before refreshing.');
                return;
            }
            if (!res.ok) { this.showToast('Refresh failed'); return; }
            this.showToast('Re-scanning folders now.');
        } catch (e) {
            console.error('Refresh failed', e);
            this.showToast('Refresh failed');
        }
    },

    // -------------------------------------------------------------------------
    // Label / preset data loaders
    // -------------------------------------------------------------------------

    async loadLabels() {
        const res = await fetch('/api/labels');
        this.state.allLabels = await res.json();
    },

    async loadPresets() {
        const res = await fetch('/api/presets');
        this.state.allPresets = await res.json();
        // Set active preset to ALL (is_system=1) on first load
        if (this.state.activePresetId === null && this.state.allPresets.length > 0) {
            const all = this.state.allPresets.find(p => p.is_system);
            if (all) this.state.activePresetId = null; // null = ALL
        }
    },

    async loadSampleLabels(digest) {
        const res = await fetch(`/api/sample/${digest}/labels`);
        this.state.currentSampleLabelIds = await res.json();
    },

    async loadUntaggedCount() {
        try {
            const res = await fetch('/api/samples/untagged-count');
            const data = await res.json();
            this.untaggedCount = data.count;
        } catch (e) {
            console.error('Failed to load untagged count', e);
        }
    },

    // -------------------------------------------------------------------------
    // Render helpers
    // -------------------------------------------------------------------------

    renderLabelPanel() {
        this.renderPresetBox();
        this.renderLabelList();
    },

    renderUntaggedRow() {
        const row = this.elements.untaggedRow;
        if (!row) return;
        row.innerHTML = '';
        const tag = document.createElement('span');
        tag.className = this.state.untaggedFilterActive ? 'label-tag' : 'label-tag dimmed';
        tag.style.backgroundColor = 'var(--accent-color)';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'label-name';
        nameSpan.textContent = 'UNTAGGED';
        const countSpan = document.createElement('span');
        countSpan.className = 'label-count';
        countSpan.textContent = this.untaggedCount ?? '…';
        tag.appendChild(nameSpan);
        tag.appendChild(countSpan);
        row.appendChild(tag);
    },

    toggleUntaggedFilter() {
        this.state.untaggedFilterActive = !this.state.untaggedFilterActive;
        if (this.state.untaggedFilterActive) {
            this.state.allPresetSelectedLabelIds = [];
        }
        this.renderLabelList();
        this.renderPresetBox();
    },

    renderPresetBox() {
        const activePreset = this.state.allPresets.find(p =>
            this.state.activePresetId === null ? p.is_system : p.id === this.state.activePresetId
        );
        const nameInput = this.elements.presetNameInput;
        const isAll = !activePreset || activePreset.is_system;

        nameInput.value = activePreset ? activePreset.name : '';
        nameInput.readOnly = isAll;
        this.elements.presetDeleteBtn.disabled = isAll;

        // Render preset list items
        this.elements.presetList.innerHTML = '';
        for (const p of this.state.allPresets) {
            const div = document.createElement('div');
            div.className = 'preset-item' + (
                (this.state.activePresetId === null && p.is_system && this.state.allPresetSelectedLabelIds.length === 0) ||
                p.id === this.state.activePresetId ? ' active' : ''
            );
            div.textContent = p.name;
            div.dataset.presetId = p.id;
            div.dataset.isSystem = p.is_system;
            div.addEventListener('click', () => this.selectPreset(p));
            this.elements.presetList.appendChild(div);
        }
    },

    renderLabelList() {
        this.renderUntaggedRow();
        this.elements.labelList.innerHTML = '';
        const isAll = this.state.activePresetId === null;
        const activePreset = this.state.allPresets.find(p => p.id === this.state.activePresetId);
        const presetLabelIds = new Set(activePreset ? activePreset.labels : []);
        const sampleLabelIds = new Set(this.state.currentSampleLabelIds);
        const transientIds = new Set(this.state.allPresetSelectedLabelIds);
        const hasSample = this.state.currentDigest !== null;

        for (const label of this.state.allLabels) {
            const li = document.createElement('li');
            li.className = 'label-tag-row';

            // Sample membership checkbox
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = sampleLabelIds.has(label.id);
            cb.disabled = !hasSample;
            cb.dataset.labelId = label.id;
            cb.addEventListener('change', () => {
                cb.blur();
                this.toggleSampleLabel(label.id, cb.checked);
            });

            // Bookmark tag
            const tag = document.createElement('span');
            tag.className = 'label-tag';
            tag.style.backgroundColor = 'var(--accent-color)';
            const dimmed = isAll ? !transientIds.has(label.id) : !presetLabelIds.has(label.id);
            if (dimmed) tag.classList.add('dimmed');
            tag.dataset.labelId = label.id;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'label-name';
            nameSpan.textContent = label.name;

            const countSpan = document.createElement('span');
            countSpan.className = 'label-count';
            countSpan.textContent = label.sample_count;

            const editBtn = document.createElement('button');
            editBtn.className = 'label-edit';
            editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
            editBtn.title = 'Rename label';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startLabelEdit(label, tag, nameSpan, countSpan);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'label-delete';
            delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            delBtn.title = 'Delete label';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteLabel(label);
            });

            tag.appendChild(nameSpan);
            tag.appendChild(countSpan);
            tag.appendChild(editBtn);
            tag.appendChild(delBtn);

            tag.addEventListener('click', () => {
                document.activeElement.blur();
                if (isAll) {
                    this.toggleAllPresetSelection(label.id);
                } else {
                    this.togglePresetLabel(label.id, !presetLabelIds.has(label.id));
                }
            });

            li.appendChild(cb);
            li.appendChild(tag);
            this.elements.labelList.appendChild(li);
        }
    },

    renderLabelListCheckboxes() {
        const sampleLabelIds = new Set(this.state.currentSampleLabelIds);
        const hasSample = this.state.currentDigest !== null;
        this.elements.labelList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const lid = parseInt(cb.dataset.labelId, 10);
            cb.checked = sampleLabelIds.has(lid);
            cb.disabled = !hasSample;
        });
    },

    renderSampleLabelBar() {
        const bar = this.elements.sampleLabelBar;
        bar.innerHTML = '';
        const ids = new Set(this.state.currentSampleLabelIds);
        const labels = this.state.allLabels.filter(l => ids.has(l.id));
        if (labels.length === 0) {
            bar.classList.remove('has-labels');
            return;
        }
        bar.classList.add('has-labels');
        for (const label of labels) {
            const chip = document.createElement('span');
            chip.className = 'sample-label-chip';
            chip.style.backgroundColor = 'var(--accent-color)';
            chip.textContent = label.name;
            bar.appendChild(chip);
        }
    },

    // -------------------------------------------------------------------------
    // Preset actions
    // -------------------------------------------------------------------------

    selectPreset(preset) {
        this.state.untaggedFilterActive = false;
        const wasAll = this.state.activePresetId === null;
        this.state.activePresetId = preset.is_system ? null : preset.id;
        if (!preset.is_system) {
            this.state.activePresetLabelIds = preset.labels.slice();
            this.state.activeFilterMode = preset.filter_mode || 'OR';
        } else {
            // Revert to the ALL-preset default: no label filter, no transient selections.
            this.state.activePresetLabelIds = [];
            this.state.activeFilterMode = 'OR';
            this.state.allPresetSelectedLabelIds = [];
        }
        if (!preset.is_system && wasAll) {
            this.state.allPresetSelectedLabelIds = [];
        }
        this.renderLabelPanel();
    },

    async addPreset() {
        try {
            const suggestRes = await fetch('/api/presets/suggest-name');
            const { name } = await suggestRes.json();
            const labelIds = this.state.allPresetSelectedLabelIds.slice();
            const res = await fetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, label_ids: labelIds }),
            });
            if (!res.ok) { console.error('Failed to create preset'); return; }
            const preset = await res.json();
            await this.loadPresets();
            // Activate the new preset
            const found = this.state.allPresets.find(p => p.id === preset.id);
            if (found) {
                // Activate the freshly created preset immediately so the UI reflects it without
                // requiring the user to click it in the list.
                this.state.activePresetId = found.id;
                this.state.activePresetLabelIds = found.labels.slice();
                this.state.activeFilterMode = found.filter_mode || 'OR';
                this.state.allPresetSelectedLabelIds = [];
            }
            this.renderLabelPanel();
            this.elements.presetNameInput.readOnly = false;
            this.elements.presetNameInput.focus();
            this.elements.presetNameInput.select();
        } catch (e) {
            console.error(e);
        }
    },

    async renamePreset(newName) {
        if (!this.state.activePresetId) return;
        try {
            const res = await fetch(`/api/presets/${this.state.activePresetId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
            });
            if (!res.ok) return;
            const { name } = await res.json();
            await this.loadPresets();
            this.elements.presetNameInput.value = name;
            this.renderPresetBox();
        } catch (e) {
            console.error(e);
        }
    },

    async deletePreset() {
        if (!this.state.activePresetId) return;
        try {
            const res = await fetch(`/api/presets/${this.state.activePresetId}`, { method: 'DELETE' });
            if (!res.ok)
                return;

            // Fall back to the ALL preset (no active preset, no label filter).
            this.state.activePresetId = null;
            this.state.activePresetLabelIds = [];
            this.state.activeFilterMode = 'OR';

            await this.loadPresets();
            this.renderLabelPanel();
        } catch (e) {
            console.error(e);
        }
    },

    async togglePresetLabel(labelId, add) {
        this.state.untaggedFilterActive = false;
        const pid = this.state.activePresetId;
        if (!pid) return;
        const preset = this.state.allPresets.find(p => p.id === pid);
        if (!preset) return;

        const label = this.state.allLabels.find(l => l.id === labelId);
        const labelName = label ? label.name : labelId;

        // Optimistic update
        if (add) {
            preset.labels.push(labelId);
            this.state.activePresetLabelIds = preset.labels.slice();
            this.showToast(`Label ${labelName} added to ${preset.name}`);
        } else {
            preset.labels = preset.labels.filter(id => id !== labelId);
            this.state.activePresetLabelIds = preset.labels.slice();
            this.showToast(`Removed label ${labelName} from ${preset.name}`);
        }
        this.renderLabelList();

        try {
            const method = add ? 'POST' : 'DELETE';
            const res = await fetch(`/api/presets/${pid}/labels/${labelId}`, { method });
            if (!res.ok) {
                // Revert
                await this.loadPresets();
                this.renderLabelList();
            }
        } catch (e) {
            console.error(e);
            await this.loadPresets();
            this.renderLabelList();
        }
    },

    toggleAllPresetSelection(labelId) {
        this.state.untaggedFilterActive = false;
        const idx = this.state.allPresetSelectedLabelIds.indexOf(labelId);
        if (idx === -1) {
            this.state.allPresetSelectedLabelIds.push(labelId);
        } else {
            this.state.allPresetSelectedLabelIds.splice(idx, 1);
        }
        this.renderLabelList();
        this.renderPresetBox();
    },

    // -------------------------------------------------------------------------
    // Label actions
    // -------------------------------------------------------------------------

    async createLabel() {
        const name = this.elements.labelNameInput.value.trim();
        if (!name) return;
        try {
            const res = await fetch('/api/labels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (res.status === 409) { this.showToast('Label already exists'); return; }
            if (!res.ok) return;
            this.elements.labelNameInput.value = '';
            this.elements.labelAddForm.style.display = 'none';
            await this.loadLabels();
            this.renderLabelList();
        } catch (e) {
            console.error(e);
        }
    },

    async deleteLabel(label) {
        try {
            const usageRes = await fetch(`/api/labels/${label.id}/usage`);
            const { sample_count } = await usageRes.json();
            if (sample_count > 0) {
                const ok = confirm(`Are you sure you want to delete label "${label.name}"? ${sample_count} sample(s) are using it.`);
                if (!ok) return;
            }
            const res = await fetch(`/api/labels/${label.id}`, { method: 'DELETE' });
            if (!res.ok) return;
            // Remove from state arrays
            this.state.currentSampleLabelIds = this.state.currentSampleLabelIds.filter(id => id !== label.id);
            this.state.allPresetSelectedLabelIds = this.state.allPresetSelectedLabelIds.filter(id => id !== label.id);
            await this.loadLabels();
            await this.loadPresets();
            await this.loadUntaggedCount();
            this.renderLabelPanel();
            this.renderSampleLabelBar();
        } catch (e) {
            console.error(e);
        }
    },

    startLabelEdit(label, tag, nameSpan, countSpan) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'label-edit-input';
        input.value = label.name;

        nameSpan.replaceWith(input);
        countSpan.style.display = 'none';
        input.focus();
        input.select();

        let committed = false;

        const commit = async () => {
            if (committed) return;
            committed = true;
            const newName = input.value.trim();
            if (newName && newName !== label.name) {
                await this.renameLabel(label.id, newName);
            } else {
                input.replaceWith(nameSpan);
                countSpan.style.display = '';
            }
        };

        const cancel = () => {
            if (committed) return;
            committed = true;
            input.replaceWith(nameSpan);
            countSpan.style.display = '';
        };

        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            e.stopPropagation();
        });
        input.addEventListener('blur', cancel);
    },

    async renameLabel(labelId, newName) {
        try {
            const res = await fetch(`/api/labels/${labelId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
            });
            if (!res.ok) return;
            await this.loadLabels();
            this.renderLabelPanel();
            this.renderSampleLabelBar();
        } catch (e) {
            console.error(e);
        }
    },

    async toggleSampleLabel(labelId, add) {
        const digest = this.state.currentDigest;
        if (!digest) return;
        try {
            let res;
            if (add) {
                res = await fetch(`/api/sample/${digest}/labels`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label_id: labelId }),
                });
            } else {
                res = await fetch(`/api/sample/${digest}/labels/${labelId}`, { method: 'DELETE' });
            }
            if (!res.ok) { console.error('toggleSampleLabel failed'); return; }
            // Reload to get authoritative state, then re-render
            await this.loadSampleLabels(digest);
            // Also reload label list so sample_count badges stay accurate
            await this.loadLabels();
            await this.loadUntaggedCount();
            this.renderSampleLabelBar();
            this.renderLabelListCheckboxes();
            this.renderUntaggedRow();
            // Update count badges without full re-render
            this.elements.labelList.querySelectorAll('.label-count').forEach(el => {
                const row = el.closest('.label-tag-row');
                if (!row) return;
                const tag = row.querySelector('.label-tag');
                if (!tag) return;
                const lid = parseInt(tag.dataset.labelId, 10);
                const found = this.state.allLabels.find(l => l.id === lid);
                if (found) el.textContent = found.sample_count;
            });
        } catch (e) {
            console.error(e);
        }
    },

    // -------------------------------------------------------------------------
    // Folder dialog
    // -------------------------------------------------------------------------

    openFolderDialog() {
        this.state.folderDialogLabelIds = [];
        this.elements.folderPathInput.value = '';
        this.elements.folderDialogOk.disabled = true;
        this.renderFolderDialogLabels();
        this.elements.folderDialogOverlay.classList.remove('hidden');
        this.elements.folderPathInput.focus();
    },

    closeFolderDialog() {
        this.elements.folderDialogOverlay.classList.add('hidden');
        this.state.folderDialogLabelIds = [];
        this.elements.folderPathInput.value = '';
        this.elements.folderDialogOk.disabled = true;
    },

    renderFolderDialogLabels() {
        const container = this.elements.folderDialogLabels;
        container.innerHTML = '';
        const hint = document.getElementById('dialog-label-hint');
        if (hint) hint.style.display = this.state.allLabels.length > 0 ? '' : 'none';
        const selected = new Set(this.state.folderDialogLabelIds);
        for (const label of this.state.allLabels) {
            const tag = document.createElement('span');
            tag.className = 'label-tag' + (selected.has(label.id) ? '' : ' dimmed');
            tag.textContent = label.name;
            tag.style.backgroundColor = 'var(--accent-color)';
            tag.style.cursor = 'pointer';
            tag.addEventListener('click', () => {
                const idx = this.state.folderDialogLabelIds.indexOf(label.id);
                if (idx === -1) {
                    this.state.folderDialogLabelIds.push(label.id);
                } else {
                    this.state.folderDialogLabelIds.splice(idx, 1);
                }
                this.renderFolderDialogLabels();
            });
            container.appendChild(tag);
        }
    },

    async submitFolderDialog() {
        const path = this.elements.folderPathInput.value.trim();
        if (!path) return;

        this.elements.folderDialogOk.disabled = true;
        try {
            const res = await fetch('/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, label_ids: this.state.folderDialogLabelIds }),
            });
            const data = await res.json();
            if (res.status === 201) {
                this._hideFirstRunOverlay();
                this.closeFolderDialog();
                this.showToast('Folder added — scanning…');
                return;
            }
            if (res.status === 409) { this.showToast('Folder already added'); }
            else if (data.error === 'path_not_found') { this.showToast('Path does not exist'); }
            else if (data.error === 'not_a_directory') { this.showToast('Path is not a directory'); }
            else { this.showToast('Could not add folder'); }
        } catch (e) {
            console.error(e);
            this.showToast('Could not add folder');
        } finally {
            this.elements.folderDialogOk.disabled = !this.elements.folderPathInput.value.trim();
        }
    },

    async _checkFirstRun() {
        if (this.state.totalSamplesCount > 0) return;
        try {
            const res = await fetch('/api/folders');
            const folders = await res.json();
            if (folders.length === 0) this._showFirstRunOverlay();
        } catch (e) {
            console.error('First-run check failed', e);
        }
    },

    _showFirstRunOverlay() {
        if (!this.elements.firstRunOverlay) return;
        if (this.state.appVersion && this.elements.firstRunHeading) {
            this.elements.firstRunHeading.textContent =
                `Welcome to GrooveDropper ${this.state.appVersion}`;
        }
        this.elements.firstRunOverlay.classList.add('visible');
    },

    _hideFirstRunOverlay() {
        if (this.elements.firstRunOverlay) {
            this.elements.firstRunOverlay.classList.remove('visible');
        }
    },

});
