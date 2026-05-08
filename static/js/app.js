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
        untaggedFilterActive: false,
        controlsFolded: false,
        folderDialogLabelIds: [],
        dbPath: null,
        pitchSemitones: 0,
        pitchCents: 0,
        isScanning: null,
        appVersion: '',
        sampleName: null,
        sampleDir: null,
        quickpick: {
            presets: [],
            activePresetId: null,
            slots: {},
            playInstantly: false,
            focusedSlot: null,
        },
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
        offsetLabel: document.getElementById('offset-label'),
        playStatus: document.getElementById('play-status-icon'),
        themeSelect: document.getElementById('theme-select'),
        toast: document.getElementById('toast'),
        // Label panel
        presetNameInput: document.getElementById('preset-name-input'),
        presetAddBtn: document.getElementById('preset-add-btn'),
        presetDeleteBtn: document.getElementById('preset-delete-btn'),
        presetList: document.getElementById('preset-list'),
        labelList: document.getElementById('label-list'),
        untaggedRow: document.getElementById('untagged-label-row'),
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
        // Quick Pick
        qpAddBtn: document.getElementById('qp-add-btn'),
        qpPresetSelect: document.getElementById('qp-preset-select'),
        qpRenameBtn: document.getElementById('qp-rename-btn'),
        qpPlayInstantly: document.getElementById('qp-play-instantly'),
        qpSlots: document.getElementById('qp-slots'),
        qpDeleteBtn: document.getElementById('qp-delete-btn'),
    },

    init() {
        this.loadQuickpickPresets()
            .then(() => this.loadConfig())
            .then(() => this.renderQuickpickBar())
            .catch(e => console.error(e));
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
        this._initInfoCopyIcons();

        this._attachPitchDrag(this.elements.pitchSemitoneDrag, (steps) => this.adjustPitch(steps, 0));
        this._attachPitchDrag(this.elements.pitchCentsDrag, (steps) => this.adjustPitch(0, steps * 10));
        this.elements.pitchResetBtn.addEventListener('click', () => {
            this.resetPitch()
            this.elements.pitchResetBtn.blur();
        });

        this.loadLabels()
            .then(() => this.loadUntaggedCount())
            .then(() => this.loadPresets())
            .then(() => {
                this.renderLabelPanel();
                this.renderSampleLabelBar();
            })
            .catch(e => console.error('Label init error', e));
    },

    _initInfoCopyIcons() {
        const copyMap = [
            { id: 'copy-icon-name',     getValue: () => this.state.sampleName,                    toast: 'Filename copied!' },
            { id: 'copy-icon-dir',      getValue: () => this.state.sampleDir,                     toast: 'Directory copied!' },
            { id: 'copy-icon-size',     getValue: () => this.elements.sampleSize.textContent,     toast: 'Size copied!' },
            { id: 'copy-icon-duration', getValue: () => this.elements.sampleDuration.textContent, toast: 'Duration copied!' },
            { id: 'copy-icon-offset',   getValue: () => this.elements.sampleOffset.value,         toast: 'Offset copied!' },
        ];
        const getFullPath = () => {
            const dir = this.state.sampleDir;
            const name = this.state.sampleName;
            if (!dir || !name) return null;
            const sep = dir.includes('\\') ? '\\' : '/';
            return dir.endsWith(sep) ? dir + name : dir + sep + name;
        };

        for (const { id, getValue, toast } of copyMap) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.addEventListener('click', (e) => {
                if (e.shiftKey && (id === 'copy-icon-name' || id === 'copy-icon-dir')) {
                    const fullPath = getFullPath();
                    if (!fullPath) return;
                    navigator.clipboard.writeText(fullPath)
                        .then(() => this.showToast('Copied full path to sample'))
                        .catch(err => console.error('Copy failed:', err));
                    return;
                }
                const val = getValue();
                if (!val || val === '-') return;
                navigator.clipboard.writeText(val)
                    .then(() => this.showToast(toast))
                    .catch(err => console.error('Copy failed:', err));
            });
        }
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
            }
            if (config.loop !== undefined) {
                this.state.loopEnabled = config.loop === 'true';
                this.updateLoopButton();
            }
            if (config['controls-folded'] !== undefined) {
                this.state.controlsFolded = config['controls-folded'] === 'true';
                this.applyControlsFold();
            }
            if (config['quick-play-instantly'] !== undefined) {
                this.state.quickpick.playInstantly = config['quick-play-instantly'] === 'true';
                this.elements.qpPlayInstantly.checked = this.state.quickpick.playInstantly;
            }
            if (config['quick-pick-preset']) {
                const presetId = parseInt(config['quick-pick-preset']);
                if (!isNaN(presetId) && this.state.quickpick.presets.find(p => p.id === presetId)) {
                    this.state.quickpick.activePresetId = presetId;
                    await this.loadQuickpickSlots(presetId);
                }
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
                        .then(() => this.loadUntaggedCount())
                        .then(() => this.renderLabelPanel())
                        .catch(e => console.error('Label refresh after scan:', e));
                }
                this.state.isScanning = false;
            } else {
                const totalWavs = data.total_wavs || 0;
                const foldersQueued = data.folders_queued || 0;
                const processed = totalWavs - (data.wavs_queued || 0);
                let msg = `Scanning ${processed} of ${totalWavs}`;
                if (foldersQueued > 0) msg += ` (queued ${foldersQueued} items)`;
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

            const body = { label_ids: labelIds, filter_mode: filterMode };
            if (this.state.untaggedFilterActive) {
                body.untagged_only = true;
                body.label_ids = [];
            }

            const res = await fetch('/api/sample/random', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) { console.error("No samples"); return; }
            const data = await res.json();
            if (data.error === 'no_samples') {
                this.showToast('No samples in current preset selection');
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
        this.state.sampleName = data.name;
        this.state.sampleDir = data.directory;

        this.elements.indexInput.value = data.index_num;
        this.elements.sampleName.textContent = data.name;
        this.truncatePathLeft(this.elements.sampleDir, data.directory);
        this.elements.sampleSize.textContent = this.formatBytes(data.size);
        this.elements.sampleDuration.textContent = this.formatTime(data.duration);
        this.updateOffsetDisplay(data.start_offset);
        this.updateOffsetMax();

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

    updateOffsetMax() {
        const max = this.state.durationSamples > 0 ? this.formatSampleOffset(this.state.durationSamples) : '--------';
        this.elements.offsetLabel.textContent = `Offset (${max}):`;
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

    addEventListeners() {
        this.elements.themeSelect.addEventListener('change', (e) => this.changeTheme(e.target.value));
        this.elements.loopBtn.addEventListener('click', () => this.toggleLoop());
        document.getElementById('controls-header').addEventListener('click', () => this.toggleControlsFold());

        this.elements.waveformContainer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            this.seekToWaveformClick(e.clientX, false);
        });

        this.elements.waveformContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.seekToWaveformClick(e.clientX, true);
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

        this.elements.sampleOffset.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                e.preventDefault();
                if (!this.state.currentSampleId || this.state.durationSamples <= 0) return;
                const val = parseInt(this.elements.sampleOffset.value.trim(), 10);
                if (isNaN(val) || val < 0 || val > this.state.durationSamples) {
                    this.elements.sampleOffset.classList.add('error');
                } else {
                    this.elements.sampleOffset.classList.remove('error');
                    this.elements.sampleOffset.blur();
                    const newOffset = val;
                    this.state.originalStartOffset = newOffset;
                    this.state.currentOffset = newOffset;
                    const wasPlaying = this.state.isPlaying;
                    this.state.skipEndedEvent = true;
                    this.elements.audio.pause();
                    this.elements.audio.currentTime = newOffset / this.state.sampleRate;
                    this.updateOffsetDisplay(newOffset);
                    this.updatePlayhead();
                    this.flashPlayhead();
                    if (wasPlaying) {
                        this._stopPlayheadUpdater();
                        this.elements.audio.play();
                        this._startPlayheadUpdater();
                    }
                    setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
                }
            } else if (e.code === 'Escape') {
                e.preventDefault();
                this.elements.sampleOffset.classList.remove('error');
                this.elements.sampleOffset.blur();
                this.updateOffsetDisplay(this.state.currentOffset);
            }
        });

        this.elements.sampleOffset.addEventListener('input', () => {
            this.elements.sampleOffset.classList.remove('error');
        });

        this.elements.sampleOffset.addEventListener('blur', () => {
            this.elements.sampleOffset.classList.remove('error');
            this.updateOffsetDisplay(this.state.currentOffset);
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
                this._clearFocusedQpSlot();
                if (e.shiftKey) this.randomizeCurrentOffset(true).catch(err => console.error(err));
                else this.loadNextRandom(true).catch(err => console.error(err));
            } else if (e.code === 'KeyP') {
                this._clearFocusedQpSlot();
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
            } else if (e.code === 'KeyV') {
                this.storeToNextFreeQpSlot().catch(err => console.error(err));
            } else if (/^Digit[0-9]$/.test(e.code)) {
                const keyDigit = e.code.slice(-1);
                const slotNumber = keyDigit === '0' ? 10 : parseInt(keyDigit);
                if (e.shiftKey) {
                    this.saveQuickpickSlot(slotNumber).catch(err => console.error(err));
                    this._setFocusedQpSlot(slotNumber);
                } else {
                    if (this.state.quickpick.slots[String(slotNumber)]) {
                        this._setFocusedQpSlot(slotNumber);
                    }
                    this.recallQuickpickSlot(slotNumber).catch(err => console.error(err));
                }
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

        // UNTAGGED toggle
        if (this.elements.untaggedRow) {
            this.elements.untaggedRow.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.toggleUntaggedFilter();
            });
        }

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

        // Quick Pick bar
        this.elements.qpAddBtn.addEventListener('click', () => this.addQuickpickPreset().catch(e => console.error(e)));
        this.elements.qpDeleteBtn.addEventListener('click', () => {
            this.elements.qpDeleteBtn.blur();
            this.deleteQuickpickPreset().catch(e => console.error(e));
        });

        this.elements.qpPresetSelect.addEventListener('change', async () => {
            const val = this.elements.qpPresetSelect.value;
            const presetId = val ? parseInt(val) : null;
            this.state.quickpick.activePresetId = presetId;
            this.state.quickpick.slots = {};
            this.state.quickpick.focusedSlot = null;
            if (presetId) {
                await this.loadQuickpickSlots(presetId);
                await this.saveConfig('quick-pick-preset', String(presetId));
            } else {
                await this.saveConfig('quick-pick-preset', '');
            }
            this.renderQuickpickBar();
            this.elements.qpPresetSelect.blur();
        });

        this.elements.qpRenameBtn.addEventListener('click', () => {
            this.elements.qpRenameBtn.blur();
            this.startQuickpickRename();
        });

        this.elements.qpPlayInstantly.addEventListener('change', () => {
            this.state.quickpick.playInstantly = this.elements.qpPlayInstantly.checked;
            this.elements.qpPlayInstantly.blur();
            this.saveConfig('quick-play-instantly', String(this.state.quickpick.playInstantly)).catch(e => console.error(e));
        });

        this.elements.audio.addEventListener('ended', () => {
            if (this.state.skipEndedEvent) return;
            if (this.state.loopEnabled) {
                this.elements.audio.currentTime = this.state.originalStartOffset / this.state.sampleRate;
                this.state.currentOffset = this.state.originalStartOffset;
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
