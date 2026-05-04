const GrooveDropper = {
    state: {
        currentSampleId: null,
        currentDigest: null,
        totalDuration: 0,
        currentOffset: 0,
        originalStartOffset: 0,
        sampleRate: 44100,
        durationSamples: 0,
        isPlaying: false,
        statusInterval: null,
        loopEnabled: true,
        skipEndedEvent: false,  // suppresses the 'ended' handler while seeking or swapping src
        historyQueue: [],
        historyIndex: -1,
        totalSamplesCount: 0,
        // Label system
        activePresetId: null,
        activePresetLabelIds: [],
        activeFilterMode: 'OR',
        allLabels: [],
        allPresets: [],
        currentSampleLabelIds: [],
        allPresetSelectedLabelIds: [],  // transient label filter used when the "ALL" preset is active
        controlsFolded: false,
        folderDialogLabelIds: [],
        dbPath: null,
        pitchSemitones: 0,
        pitchCents: 0,
        isScanning: null,
        appVersion: '',
    },

    elements: {
        audio: document.getElementById('audio-player'),
        playhead: document.getElementById('playhead'),
        waveformContainer: document.getElementById('waveform-container'),
        waveformImg: document.getElementById('waveform-img'),
        loopBtn: document.getElementById('loop-toggle'),
        indexInput: document.getElementById('current-index'),
        totalSamples: document.getElementById('total-samples'),
        scanStatus: document.getElementById('scan-status'),
        sampleName: document.getElementById('sample-name'),
        sampleDir: document.getElementById('sample-dir'),
        sampleSize: document.getElementById('sample-size'),
        sampleDuration: document.getElementById('sample-duration'),
        sampleOffset: document.getElementById('sample-offset'),
        playStatus: document.getElementById('play-status-icon'),
        themeSelect: document.getElementById('theme-select'),
        toast: document.getElementById('toast'),
        // Label panel
        presetNameInput: document.getElementById('preset-name-input'),
        presetAddBtn: document.getElementById('preset-add-btn'),
        presetDeleteBtn: document.getElementById('preset-delete-btn'),
        presetList: document.getElementById('preset-list'),
        labelList: document.getElementById('label-list'),
        labelAddBtn: document.getElementById('label-add-btn'),
        labelAddForm: document.getElementById('label-add-form'),
        labelNameInput: document.getElementById('label-name-input'),
        labelSaveBtn: document.getElementById('label-save-btn'),
        labelCancelBtn: document.getElementById('label-cancel-btn'),
        sampleLabelBar: document.getElementById('sample-label-bar'),
        controlsInfo: document.getElementById('controls-info'),
        controlsFoldIcon: document.getElementById('controls-fold-icon'),
        appVersion: document.getElementById('app-version'),
        firstRunOverlay: document.getElementById('first-run-overlay'),
        firstRunHeading: document.getElementById('first-run-heading'),
        firstRunDismiss: document.getElementById('first-run-dismiss'),
        pitchBadge: document.getElementById('pitch-badge'),
        pitchSemitoneDrag: document.getElementById('pitch-semitone-drag'),
        pitchCentsDrag: document.getElementById('pitch-cents-drag'),
        pitchResetBtn: document.getElementById('pitch-reset-btn'),
        // Folder buttons
        folderAddBtn: document.getElementById('folder-add-btn'),
        folderManageBtn: document.getElementById('folder-manage-btn'),
        // Folder add dialog
        folderDialogOverlay: document.getElementById('folder-dialog-overlay'),
        folderDialogClose: document.getElementById('folder-dialog-close'),
        folderPathInput: document.getElementById('folder-path-input'),
        folderDialogLabels: document.getElementById('folder-dialog-labels'),
        folderDialogCancel: document.getElementById('folder-dialog-cancel'),
        folderDialogOk: document.getElementById('folder-dialog-ok'),
        // Refresh button + dialog
        refreshBtn: document.getElementById('refresh-btn'),
        refreshDialogOverlay: document.getElementById('refresh-dialog-overlay'),
        refreshDialogClose: document.getElementById('refresh-dialog-close'),
        refreshDialogCancel: document.getElementById('refresh-dialog-cancel'),
        refreshDialogConfirm: document.getElementById('refresh-dialog-confirm'),
        refreshDeleteLabelsCb: document.getElementById('refresh-delete-labels-cb'),
        refreshCountBullet: document.getElementById('refresh-count-bullet'),
        refreshBulletLabels: document.getElementById('refresh-bullet-labels'),
        refreshDbPathText: document.getElementById('refresh-db-path-text'),
    },

    init() {
        this.loadConfig().catch(e => console.error(e));
        this.loadInfo().catch(e => console.error(e));
        this.state.statusInterval = setInterval(() => this.pollStatus(), 5000);

        this.pollStatus().then(() => {
            const urlParams = this.checkUrlParams();
            if (urlParams) {
                this.loadSpecificDigest(urlParams.digest, urlParams.startOffset, urlParams.pitch, urlParams.cents).catch(e => console.error(e));
            } else if (this.state.currentSampleId === null && this.state.totalSamplesCount > 0) {
                this.loadNextRandom(false).catch(e => console.error(e));
            }
            this._checkFirstRun().catch(e => console.error(e));
        }).catch(e => console.error(e));

        if (this.elements.firstRunDismiss) {
            this.elements.firstRunDismiss.addEventListener('click', () => this._hideFirstRunOverlay());
        }

        this.addEventListeners();

        this._attachPitchDrag(this.elements.pitchSemitoneDrag, (steps) => this.adjustPitch(steps, 0));
        this._attachPitchDrag(this.elements.pitchCentsDrag, (steps) => this.adjustPitch(0, steps * 10));
        this.elements.pitchResetBtn.addEventListener('click', () => {
            this.resetPitch()
            this.elements.pitchResetBtn.blur();
        });

        this.loadLabels()
            .then(() => this.loadPresets())
            .then(() => {
                this.renderLabelPanel();
                this.renderSampleLabelBar();
            })
            .catch(e => console.error('Label init error', e));
    },

    checkUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const digest = params.get('sample');
        if (digest) {
            return {
                digest,
                startOffset: parseInt(params.get('start') ?? '0', 10),
                pitch: parseInt(params.get('pitch') ?? '0', 10),
                cents: parseInt(params.get('cents') ?? '0', 10),
            };
        }
        return null;
    },

    showToast(message) {
        this.elements.toast.textContent = message;
        this.elements.toast.className = 'show';
        setTimeout(() => { this.elements.toast.className = ''; }, 3000);
    },

    showErrorToast(message) {
        this.elements.toast.textContent = message;
        this.elements.toast.className = 'show error';
        const dismiss = () => {
            this.elements.toast.className = '';
            document.removeEventListener('keydown', dismiss);
            document.removeEventListener('click', dismiss);
        };
        document.addEventListener('keydown', dismiss);
        document.addEventListener('click', dismiss);
    },

    copyCurrentUrlToClipboard() {
        if (!this.state.currentDigest) return;
        const base = window.location.origin + window.location.pathname;
        const params = new URLSearchParams({ sample: this.state.currentDigest, start: this.state.originalStartOffset });
        const s = this.state.pitchSemitones;
        const c = this.state.pitchCents;
        if (s !== 0) params.set('pitch', s);
        if (c !== 0) params.set('cents', c);
        navigator.clipboard.writeText(`${base}?${params}`)
            .then(() => this.showToast("URL Copied to Clipboard!"))
            .catch(err => console.error("Failed to copy URL:", err));
    },

    async loadConfig() {
        try {
            const res = await fetch('/api/config');
            const config = await res.json();
            if (config.theme) {
                document.documentElement.setAttribute('data-theme', config.theme);
                this.elements.themeSelect.value = config.theme;
                this.syncLabelColorInputToTheme();
            }
            if (config.loop !== undefined) {
                this.state.loopEnabled = config.loop === 'true';
                this.updateLoopButton();
            }
            if (config['controls-folded'] !== undefined) {
                this.state.controlsFolded = config['controls-folded'] === 'true';
                this.applyControlsFold();
            }
        } catch (e) {
            console.error("Failed to load config", e);
        }
    },

    async saveConfig(key, value) {
        try {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [key]: value }),
            });
        } catch (e) {
            console.error(`Failed to save config ${key}`, e);
        }
    },

    changeTheme(themeName) {
        document.documentElement.setAttribute('data-theme', themeName);
        this.renderLabelPanel();
        this.renderSampleLabelBar();
        this.saveConfig('theme', themeName).catch(e => console.error(e));
    },

    toggleLoop() {
        this.state.loopEnabled = !this.state.loopEnabled;
        this.updateLoopButton();
        this.saveConfig('loop', String(this.state.loopEnabled)).catch(e => console.error(e));
    },

    updateLoopButton() {
        this.elements.loopBtn.classList.toggle('active', this.state.loopEnabled);
    },

    toggleControlsFold() {
        this.state.controlsFolded = !this.state.controlsFolded;
        this.applyControlsFold();
        this.saveConfig('controls-folded', String(this.state.controlsFolded)).catch(e => console.error(e));
    },

    applyControlsFold() {
        this.elements.controlsInfo.classList.toggle('folded', this.state.controlsFolded);
        this.elements.controlsFoldIcon.className = this.state.controlsFolded
            ? 'fa-solid fa-chevron-right'
            : 'fa-solid fa-chevron-down';
    },


    updateStatusText(status) {
        const icon = this.elements.playStatus.querySelector('i');
        const playing = status === 'PLAYING';
        icon.className = playing ? 'fa-solid fa-play' : 'fa-solid fa-stop';
        this.elements.playStatus.className = playing ? 'playing' : '';
    },

    shortenPath(path) {
        if (!path || path.length <= 50) return path ?? '';
        return `${path.substring(0, 20)}...${path.substring(path.length - 25)}`;
    },

    _startPlayheadUpdater() {
        cancelAnimationFrame(this._rafId);
        const tick = () => {
            this.state.currentOffset = Math.round(this.elements.audio.currentTime * this.state.sampleRate);
            this.updatePlayhead();
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    },

    _stopPlayheadUpdater() {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
    },

    _pushHistory(historyId) {
        // Branching: discard any forward entries when navigating to a new sample mid-history.
        if (this.state.historyIndex < this.state.historyQueue.length - 1) {
            this.state.historyQueue = this.state.historyQueue.slice(0, this.state.historyIndex + 1);
        }
        this.state.historyQueue.push(historyId);
        this.state.historyIndex = this.state.historyQueue.length - 1;
    },

    async pollStatus() {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();

            this.state.totalSamplesCount = data.total_samples || 0;
            this.elements.totalSamples.textContent = this.state.totalSamplesCount;

            if (!data.is_scanning) {
                this.elements.scanStatus.innerHTML = `<i class="fa-solid fa-check"></i> <span>Scan complete</span>`;
                if (this.state.isScanning === true) {
                    this.loadLabels()
                        .then(() => this.renderLabelPanel())
                        .catch(e => console.error('Label refresh after scan:', e));
                }
                this.state.isScanning = false;
            } else {
                const processed = (data.total_wavs || 0) - (data.wavs_queued || 0);
                let msg = `Scanning ${processed} of ${data.total_wavs || 0}`;
                if (data.folders_queued > 0) msg += ` (queued ${data.folders_queued} items)`;
                this.elements.scanStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${msg}</span>`;
                this.state.isScanning = true;
            }

            if (this.state.totalSamplesCount > 0 && this.state.currentSampleId === null) {
                await this.loadNextRandom(false);
            }
        } catch (e) {
            console.error("Error polling stats", e);
        }
    },

    async loadNextRandom(playInstantly = false) {
        try {
            const isAll = this.state.activePresetId === null;
            const labelIds = isAll
                ? this.state.allPresetSelectedLabelIds
                : this.state.activePresetLabelIds;
            const filterMode = isAll ? 'OR' : this.state.activeFilterMode;

            const res = await fetch('/api/sample/random', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label_ids: labelIds, filter_mode: filterMode }),
            });
            if (!res.ok) { console.error("No samples"); return; }
            const data = await res.json();
            if (data.error === 'no_samples') {
                this.showToast('No samples in current preset');
                return;
            }
            this._pushHistory(data.history_id);
            this.updateUI(data, playInstantly);
        } catch (e) {
            console.error(e);
        }
    },

    async loadSpecificIndex(indexNum) {
        try {
            const res = await fetch(`/api/sample/index/${indexNum}`);
            if (!res.ok) { this.elements.indexInput.classList.add('error'); return; }
            const data = await res.json();
            this.elements.indexInput.classList.remove('error');
            this._pushHistory(data.history_id);

            if (this.state.isPlaying) {
                this.elements.audio.pause();
                this._stopPlayheadUpdater();
                this.state.isPlaying = false;
                this.updateStatusText('STOPPED');
            }
            this.updateUI(data, false);
        } catch (e) {
            console.error("Failed to load specific index", e);
            this.elements.indexInput.classList.add('error');
        }
    },

    async loadSpecificDigest(digest, startOffset, pitch = 0, cents = 0) {
        try {
            const res = await fetch(`/api/sample/digest/${digest}?start=${startOffset}`);
            if (!res.ok) {
                this.showErrorToast(`Sample not found for the given URL (digest: ${digest})`);
                return;
            }
            const data = await res.json();
            this._pushHistory(data.history_id);
            this.updateUI(data, false);
            if (pitch !== 0 || cents !== 0) {
                this.state.pitchSemitones = pitch;
                this.state.pitchCents = cents;
                this._applyPitch();
                this._renderPitchOverlay();
            }
        } catch (e) {
            console.error("Error loading digest", e);
            this.showErrorToast('Failed to load sample from URL');
        }
    },

    async loadPrevHistory() {
        if (this.state.historyIndex <= 0) { console.log("No more history"); return; }
        this.state.historyIndex--;
        const historyId = this.state.historyQueue[this.state.historyIndex];
        try {
            const res = await fetch(`/api/history/${historyId}`);
            if (!res.ok) { console.error("History not found"); return; }
            this.updateUI(await res.json(), false);
        } catch (e) {
            console.error(e);
        }
    },


    updateUI(data, playInstantly = false) {
        this.elements.indexInput.classList.remove('error');

        this.state.currentSampleId = data.id;
        this.state.currentDigest = data.digest;
        this.state.totalDuration = data.duration;
        this.state.sampleRate = data.samplerate;
        this.state.durationSamples = data.duration_samples;
        this.state.originalStartOffset = data.start_offset;
        this.state.currentOffset = data.start_offset;

        this.elements.indexInput.value = data.index_num;
        this.elements.sampleName.textContent = data.name;
        this.truncatePathLeft(this.elements.sampleDir, data.directory);
        this.elements.sampleSize.textContent = this.formatBytes(data.size);
        this.elements.sampleDuration.textContent = this.formatTime(data.duration);
        this.updateOffsetDisplay(data.start_offset);

        this.elements.waveformImg.src = `/waveform/${data.id}?t=${Date.now()}`;
        this.elements.waveformImg.style.display = 'block';

        this.state.skipEndedEvent = true;
        this.elements.audio.src = `/audio/${data.id}`;
        this.elements.audio.currentTime = data.start_offset / data.samplerate;
        this._applyPitch();

        this.updatePlayhead();

        if (playInstantly) {
            this.elements.audio.play();
            this.state.isPlaying = true;
            this.updateStatusText('PLAYING');
            this._startPlayheadUpdater();
        } else if (this.state.isPlaying) {
            this.elements.audio.play();
        }

        setTimeout(() => { this.state.skipEndedEvent = false; }, 100);

        if (data.digest) {
            this.loadSampleLabels(data.digest).then(() => {
                this.renderSampleLabelBar();
                this.renderLabelListCheckboxes();
            }).catch(e => console.error(e));
        }
    },

    truncatePathLeft(el, path) {
        // Binary search: find the shortest tail of `path` that still fits the element width.
        el.textContent = path;
        if (el.scrollWidth <= el.clientWidth) return;
        let lo = 0, hi = path.length;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            el.textContent = '…' + path.slice(mid);
            if (el.scrollWidth <= el.clientWidth) hi = mid;
            else lo = mid;
        }
        el.textContent = '…' + path.slice(hi);
    },

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(3);
        return `${String(mins).padStart(2, '0')}:${secs.padStart(6, '0')}`;
    },

    formatSampleOffset(samples) {
        return String(samples).padStart(8, '0');
    },

    updateOffsetDisplay(sampleOffset) {
        this.elements.sampleOffset.value = this.formatSampleOffset(sampleOffset);
    },

    flashPlayhead() {
        this.elements.playhead.classList.add('flash');
        setTimeout(() => this.elements.playhead.classList.remove('flash'), 100);
    },

    updatePlayhead() {
        if (this.state.durationSamples > 0) {
            this.elements.playhead.style.left =
                `${(this.state.currentOffset / this.state.durationSamples) * 100}%`;
        }
    },

    togglePlay() {
        if (!this.state.currentSampleId) return;
        this.elements.indexInput.classList.remove('error');

        if (this.state.isPlaying) {
            this.elements.audio.pause();
            this.state.currentOffset = Math.round(this.elements.audio.currentTime * this.state.sampleRate);
            this.state.isPlaying = false;
            this._stopPlayheadUpdater();
            this.updateStatusText('STOPPED');
        } else {
            this.state.skipEndedEvent = true;
            this.elements.audio.currentTime = this.state.currentOffset / this.state.sampleRate;
            this.elements.audio.play();
            this.state.isPlaying = true;
            this.updateStatusText('PLAYING');
            this._startPlayheadUpdater();
            setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
        }
    },

    restartPlay() {
        if (!this.state.currentSampleId) return;
        this.elements.indexInput.classList.remove('error');

        this.state.currentOffset = this.state.originalStartOffset;
        this.state.skipEndedEvent = true;
        this.elements.audio.currentTime = this.state.currentOffset / this.state.sampleRate;
        this.updatePlayhead();
        this.flashPlayhead();

        if (this.state.isPlaying) this.elements.audio.play();
        setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
    },

    async randomizeCurrentOffset(playInstantly) {
        if (!this.state.currentSampleId || this.state.durationSamples <= 0) return;
        this.elements.indexInput.classList.remove('error');

        try {
            const res = await fetch('/api/sample/random', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sample_id: this.state.currentSampleId, randomize_only: true }),
            });
            if (!res.ok) { console.error("Failed to randomize offset"); return; }

            const data = await res.json();
            this.state.originalStartOffset = data.start_offset;
            this.state.currentOffset = data.start_offset;
            this.state.skipEndedEvent = true;
            this.elements.audio.currentTime = data.start_offset / this.state.sampleRate;
            this.updateOffsetDisplay(data.start_offset);
            this.updatePlayhead();
            this.flashPlayhead();

            if (playInstantly && !this.state.isPlaying) {
                this.elements.audio.play();
                this.state.isPlaying = true;
                this.updateStatusText('PLAYING');
                this._startPlayheadUpdater();
            } else if (this.state.isPlaying) {
                this.elements.audio.play();
            }
            setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
        } catch (e) {
            console.error("Error calling randomize API:", e);
        }
    },

    downloadSlice() {
        if (!this.state.currentSampleId) return;
        const params = new URLSearchParams({ start: this.state.originalStartOffset });
        const s = this.state.pitchSemitones;
        const c = this.state.pitchCents;
        if (s !== 0) params.set('pitch', s);
        if (c !== 0) params.set('cents', c);
        window.location.href = `/api/slice/${this.state.currentSampleId}?${params}`;
    },

    async loadInfo() {
        try {
            const res = await fetch('/api/info');
            const data = await res.json();
            this.state.dbPath = data.db_path || '';
            if (data.version) {
                this.state.appVersion = 'v' + data.version;
                this.elements.appVersion.textContent = this.state.appVersion;
            }
        } catch (e) {
            console.error('Failed to load info', e);
        }
    },

    async openRefreshDialog() {
        // check if we have a running queue already, and if so,
        // we show a toast and exit this
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();

            if (data.is_scanning) {
                this.showToast('A scan is already running — wait for it to finish before refreshing.');
                return;
            }
        }
        catch(e) {
            console.error('Failed to get stats', e);
            return;
        }

        const count = this.state.totalSamplesCount;
        if (count === 0) {
            await this._doRefresh(false);
            return;
        }
        this.elements.refreshDeleteLabelsCb.checked = false;
        this._updateRefreshBulletLabels(false);
        const label = count === 1 ? '1 sample' : `${count} samples`;
        this.elements.refreshCountBullet.textContent = label;
        this.elements.refreshDbPathText.textContent = this.state.dbPath || 'unknown';
        this.elements.refreshDialogOverlay.classList.remove('hidden');
    },

    closeRefreshDialog() {
        this.elements.refreshDialogOverlay.classList.add('hidden');
        this.elements.refreshDeleteLabelsCb.checked = false;
        this._updateRefreshBulletLabels(false);
    },

    _updateRefreshBulletLabels(deleteLabels) {
        this.elements.refreshBulletLabels.textContent = deleteLabels
            ? 'Per-sample label assignments will be permanently deleted.'
            : 'Your per-sample labels will be restored when each file is re-indexed.';
    },

    async submitRefresh() {
        const deleteLabels = this.elements.refreshDeleteLabelsCb.checked;
        this.closeRefreshDialog();
        await this._doRefresh(deleteLabels);
    },

    async _doRefresh(deleteLabels) {
        try {
            const res = await fetch('/api/samples/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delete_sample_labels: deleteLabels }),
            });
            const data = await res.json();
            if (res.status === 409 && data.error === 'scan_in_progress') {
                this.showToast('A scan is already running — wait for it to finish before refreshing.');
                return;
            }
            if (!res.ok) { this.showToast('Refresh failed'); return; }
            this.showToast('Sample index cleared — re-scanning now.');
            await this.loadLabels();
            await this.loadPresets();
            this.renderLabelPanel();
            this.renderSampleLabelBar();
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

    // -------------------------------------------------------------------------
    // Render helpers
    // -------------------------------------------------------------------------

    renderLabelPanel() {
        this.renderPresetBox();
        this.renderLabelList();
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
        const wasAll = this.state.activePresetId === null;
        this.state.activePresetId = preset.is_system ? null : preset.id;
        if (!preset.is_system) {
            this.state.activePresetLabelIds = preset.labels.slice();
            this.state.activeFilterMode = preset.filter_mode || 'OR';
        } else {
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
            if (!res.ok) return;
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
            this.renderSampleLabelBar();
            this.renderLabelListCheckboxes();
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

    _applyPitch() {
        const total = this.state.pitchSemitones + this.state.pitchCents / 100;
        const rate = Math.pow(2, total / 12);
        this.elements.audio.preservesPitch = false;
        this.elements.audio.defaultPlaybackRate = rate;
        this.elements.audio.playbackRate = rate;
    },

    _renderPitchOverlay() {
        const s = this.state.pitchSemitones;
        const c = this.state.pitchCents;
        this.elements.pitchSemitoneDrag.textContent = (s >= 0 ? '+' : '') + s;
        this.elements.pitchCentsDrag.textContent = c + 'c';
        this.elements.pitchBadge.classList.toggle('pitch-active', s !== 0 || c !== 0);
    },

    adjustPitch(deltaSemitones, deltaCents) {
        this.state.pitchSemitones += deltaSemitones;
        this.state.pitchCents += deltaCents;
        if (this.state.pitchCents >= 100) {
            this.state.pitchSemitones += 1;
            this.state.pitchCents -= 100;
        } else if (this.state.pitchCents < 0) {
            this.state.pitchSemitones -= 1;
            this.state.pitchCents += 100;
        }
        this._applyPitch();
        this._renderPitchOverlay();
    },

    resetPitch() {
        this.state.pitchSemitones = 0;
        this.state.pitchCents = 0;
        this._applyPitch();
        this._renderPitchOverlay();
    },

    _attachPitchDrag(el, onStep) {
        let startY = 0;
        let accumulated = 0;
        const STEP_PX = 4;
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            accumulated = 0;
            const onMove = (ev) => {
                accumulated += startY - ev.clientY;
                startY = ev.clientY;
                const steps = Math.trunc(accumulated / STEP_PX);
                if (steps !== 0) {
                    accumulated -= steps * STEP_PX;
                    onStep(steps);
                }
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    },

    addEventListeners() {
        this.elements.themeSelect.addEventListener('change', (e) => this.changeTheme(e.target.value));
        this.elements.loopBtn.addEventListener('click', () => this.toggleLoop());
        document.getElementById('controls-header').addEventListener('click', () => this.toggleControlsFold());

        this.elements.waveformContainer.addEventListener('mousedown', (e) => {
            if (!this.state.currentSampleId || this.state.durationSamples <= 0) return;
            this.elements.indexInput.classList.remove('error');

            const rect = this.elements.waveformContainer.getBoundingClientRect();
            const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const newOffset = Math.round(fraction * this.state.durationSamples);

            this.state.originalStartOffset = newOffset;
            this.state.currentOffset = newOffset;

            const wasPlaying = this.state.isPlaying;
            this.state.skipEndedEvent = true;
            this.elements.audio.pause();
            this.elements.audio.currentTime = newOffset / this.state.sampleRate;
            this.updateOffsetDisplay(newOffset);
            this.updatePlayhead();
            this.flashPlayhead();

            if (wasPlaying) this.elements.audio.play();
            setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
        });

        this.elements.indexInput.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                e.preventDefault();
                const val = parseInt(this.elements.indexInput.value.trim(), 10);
                if (isNaN(val) || val < 1 || val > this.state.totalSamplesCount) {
                    this.elements.indexInput.classList.add('error');
                } else {
                    this.elements.indexInput.blur();
                    this.loadSpecificIndex(val).catch(err => console.error(err));
                }
            } else if (e.code === 'Escape') {
                e.preventDefault();
                this.elements.indexInput.blur();
                this.elements.indexInput.classList.remove('error');
            }
        });

        this.elements.indexInput.addEventListener('blur', () => {
            this.elements.indexInput.classList.remove('error');
        });

        // Refresh button + dialog
        this.elements.refreshBtn.addEventListener('click', () => this.openRefreshDialog().catch(e => console.error(e)));
        this.elements.refreshDialogClose.addEventListener('click', () => this.closeRefreshDialog());
        this.elements.refreshDialogCancel.addEventListener('click', () => this.closeRefreshDialog());
        this.elements.refreshDialogConfirm.addEventListener('click', () => this.submitRefresh().catch(e => console.error(e)));
        this.elements.refreshDeleteLabelsCb.addEventListener('change', () => {
            this._updateRefreshBulletLabels(this.elements.refreshDeleteLabelsCb.checked);
        });
        this.elements.refreshDialogOverlay.addEventListener('click', (e) => {
            if (e.target === this.elements.refreshDialogOverlay) this.closeRefreshDialog();
        });

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Escape') {
                if (!this.elements.folderDialogOverlay.classList.contains('hidden')) {
                    this.closeFolderDialog();
                    return;
                }
                if (!this.elements.refreshDialogOverlay.classList.contains('hidden')) {
                    this.closeRefreshDialog();
                    return;
                }
            }
            const tag = document.activeElement.tagName;
            if (tag === 'SELECT' || tag === 'BUTTON' || tag === 'INPUT') return;

            if (e.code === 'Space') {
                e.preventDefault();
                if (e.ctrlKey) this.copyCurrentUrlToClipboard();
                else if (e.shiftKey) this.restartPlay();
                else this.togglePlay();
            } else if (e.code === 'KeyR') {
                if (e.shiftKey) this.randomizeCurrentOffset(true).catch(err => console.error(err));
                else this.loadNextRandom(true).catch(err => console.error(err));
            } else if (e.code === 'KeyP') {
                this.loadPrevHistory().catch(err => console.error(err));
            } else if (e.code === 'KeyS') {
                this.downloadSlice();
            } else if (e.key === ',' && !e.shiftKey) {
                this.adjustPitch(-1, 0);
            } else if (e.key === '.' && !e.shiftKey) {
                this.adjustPitch(+1, 0);
            } else if (e.key === '<' || (e.key === ',' && e.shiftKey)) {
                this.adjustPitch(0, -10);
            } else if (e.key === '>' || (e.key === '.' && e.shiftKey)) {
                this.adjustPitch(0, +10);
            } else if (e.key === 'l' || e.key === 'L') {
                this.resetPitch();
            }
        });

        // Preset box
        this.elements.presetAddBtn.addEventListener('click', () => this.addPreset().catch(e => console.error(e)));
        this.elements.presetDeleteBtn.addEventListener('click', () => this.deletePreset().catch(e => console.error(e)));

        this.elements.presetNameInput.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                e.preventDefault();
                const val = this.elements.presetNameInput.value.trim();
                if (val) this.renamePreset(val).catch(err => console.error(err));
                this.elements.presetNameInput.blur();
            } else if (e.code === 'Escape') {
                e.preventDefault();
                const active = this.state.allPresets.find(p => p.id === this.state.activePresetId);
                this.elements.presetNameInput.value = active ? active.name : '';
                this.elements.presetNameInput.blur();
            }
        });

        // Label add form
        this.elements.labelAddBtn.addEventListener('click', () => {
            this.elements.labelAddForm.style.display = 'flex';
            this.elements.labelNameInput.focus();
        });
        this.elements.labelSaveBtn.addEventListener('click', () => this.createLabel().catch(e => console.error(e)));
        this.elements.labelCancelBtn.addEventListener('click', () => {
            this.elements.labelAddForm.style.display = 'none';
            this.elements.labelNameInput.value = '';
            this.elements.labelCancelBtn.blur();
        });
        this.elements.labelNameInput.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') { e.preventDefault(); this.createLabel().catch(err => console.error(err)); }
            if (e.code === 'Escape') { e.preventDefault(); this.elements.labelCancelBtn.click(); }
        });

        // Folder buttons
        this.elements.folderAddBtn.addEventListener('click', () => this.openFolderDialog());

        // Folder add dialog
        this.elements.folderDialogClose.addEventListener('click', () => this.closeFolderDialog());
        this.elements.folderDialogCancel.addEventListener('click', () => this.closeFolderDialog());
        this.elements.folderDialogOk.addEventListener('click', () => this.submitFolderDialog().catch(e => console.error(e)));

        this.elements.folderPathInput.addEventListener('input', () => {
            this.elements.folderDialogOk.disabled = !this.elements.folderPathInput.value.trim();
        });
        this.elements.folderPathInput.addEventListener('keydown', (e) => {
            if (e.code === 'Enter' && !this.elements.folderDialogOk.disabled) {
                e.preventDefault();
                this.submitFolderDialog().catch(err => console.error(err));
            } else if (e.code === 'Escape') {
                e.preventDefault();
                this.closeFolderDialog();
            }
        });

        this.elements.folderDialogOverlay.addEventListener('click', (e) => {
            if (e.target === this.elements.folderDialogOverlay) this.closeFolderDialog();
        });

        this.elements.audio.addEventListener('ended', () => {
            if (this.state.skipEndedEvent) return;
            if (this.state.loopEnabled) {
                this.elements.audio.currentTime = 0;
                this.state.currentOffset = 0;
                this._applyPitch();
                this.elements.audio.play();
            } else {
                this.state.isPlaying = false;
                this._stopPlayheadUpdater();
                this.updateStatusText('STOPPED');
            }
        });
    },
};

GrooveDropper.init();