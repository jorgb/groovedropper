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
        controlsDialogOpen: false,
        dbPath: null,
        pitchSemitones: 0,
        pitchCents: 0,
        isScanning: null,
        appVersion: '',
        sampleName: null,
        sampleDir: null,
        mutable: false,
        mutableWarn: true,
        playInstantly: false,
        markers: [],            // [{id, offset}] sorted ascending, loaded from DB
        activeMarkerIndex: -1,  // index into markers[], -1 = soft playhead
        markersDirty: false,    // true when markers need overwrite confirmation before split
        maxMarkers: 32,
        quickpick: {
            presets: [],
            activePresetId: null,
            slots: {},
            focusedSlot: null,
        },
    },

    _cutState: {},
    _transientPending: false,

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
        controlsDialogOverlay: document.getElementById('controls-dialog-overlay'),
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
        folderDialogCancel: document.getElementById('folder-dialog-cancel'),
        folderDialogOk: document.getElementById('folder-dialog-ok'),
        // Manage scan folders dialog
        manageFoldersOverlay: document.getElementById('manage-folders-overlay'),
        // Refresh button
        refreshBtn: document.getElementById('refresh-btn'),
        // Waveform markers
        markCut: document.getElementById('mark-cut'),
        // Transient finder
        btnFindTransient: document.getElementById('btn-find-transient'),
        // Mutable / archive
        mutableIndicator: document.getElementById('mutable-indicator'),
        mutableWarnOverlay: document.getElementById('mutable-warn-overlay'),
        mutableWarnCancel: document.getElementById('mutable-warn-cancel'),
        mutableWarnClose: document.getElementById('mutable-warn-close'),
        mutableWarnOk: document.getElementById('mutable-warn-ok'),
        archiveDialogOverlay: document.getElementById('archive-dialog-overlay'),
        archiveDialogMsg: document.getElementById('archive-dialog-msg'),
        archiveDialogCancel: document.getElementById('archive-dialog-cancel'),
        archiveDialogOk: document.getElementById('archive-dialog-ok'),
        archiveDialogClose: document.getElementById('archive-dialog-close'),
        deleteMarkersOverlay: document.getElementById('delete-markers-overlay'),
        deleteMarkersCancel: document.getElementById('delete-markers-cancel'),
        deleteMarkersOk: document.getElementById('delete-markers-ok'),
        deleteMarkersClose: document.getElementById('delete-markers-close'),
        overwriteMarkersOverlay: document.getElementById('overwrite-markers-overlay'),
        overwriteMarkersCancel: document.getElementById('overwrite-markers-cancel'),
        overwriteMarkersOk: document.getElementById('overwrite-markers-ok'),
        overwriteMarkersClose: document.getElementById('overwrite-markers-close'),
        markerCount: document.getElementById('marker-count'),
        markerCountDropdown: document.getElementById('marker-count-dropdown'),
        btnSetLinear: document.getElementById('btn-set-linear'),
        btnSetRandom: document.getElementById('btn-set-random'),
        // Sample cut dialog
        cutDialogOverlay:    document.getElementById('cut-dialog-overlay'),
        cutDialogClose:      document.getElementById('cut-dialog-close'),
        cutDialogCancel:     document.getElementById('cut-dialog-cancel'),
        cutDialogOk:         document.getElementById('cut-dialog-ok'),
        cutWaveformWrap:     document.getElementById('cut-waveform-wrap'),
        cutDialogWaveform:   document.getElementById('cut-dialog-waveform'),
        // Quick Pick
        qpAddBtn: document.getElementById('qp-add-btn'),
        qpCloneBtn: document.getElementById('qp-clone-btn'),
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
                if (e.ctrlKey && (id === 'copy-icon-name' || id === 'copy-icon-dir')) {
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
            if (config['quick-play-instantly'] !== undefined) {
                this.state.playInstantly = config['quick-play-instantly'] === 'true';
                this.elements.qpPlayInstantly.checked = this.state.playInstantly;
            }
            this.state.mutableWarn = config['mutable-warn'] !== 'false';
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

    toggleControlsDialog() {
        this.state.controlsDialogOpen = !this.state.controlsDialogOpen;
        this.elements.controlsDialogOverlay.classList.toggle('hidden', !this.state.controlsDialogOpen);
    },


    _pushHistory(snapshot) {
        // Branching: discard any forward entries when navigating to a new sample mid-history.
        if (this.state.historyIndex < this.state.historyQueue.length - 1) {
            this.state.historyQueue = this.state.historyQueue.slice(0, this.state.historyIndex + 1);
        }
        this.state.historyQueue.push(snapshot);
        this.state.historyIndex = this.state.historyQueue.length - 1;
    },

    async pollStatus() {
        try {
            const [statsRes, jobsRes] = await Promise.all([
                fetch('/api/stats'),
                fetch('/api/jobs'),
            ]);
            const data = await statsRes.json();
            this.state.totalSamplesCount = data.total_samples || 0;
            this.elements.totalSamples.textContent = this.state.totalSamplesCount;

            // Job status takes priority over scan status
            if (jobsRes.ok) {
                const jobs   = await jobsRes.json();
                const active = jobs.filter(j => j.status === 'queued' || j.status === 'running');
                if (active.length > 0) {
                    const cur    = active.find(j => j.status === 'running') || active[0];
                    const labels = { archive: 'Archiving…', cut: 'Slicing data…', export: 'Preparing export…' };
                    const msg    = labels[cur.job_type] || 'Processing…';
                    const extra  = active.length > 1 ? ` (+${active.length - 1} queued)` : '';
                    this.elements.scanStatus.innerHTML =
                        `<i class="fa-solid fa-spinner fa-spin"></i> <span>${msg}${extra}</span>`;
                    if (this.state.totalSamplesCount > 0 && this.state.currentSampleId === null) {
                        await this.loadNextRandom(false);
                    }
                    return;
                }
            }

            if (!data.is_scanning) {
                this.elements.scanStatus.innerHTML =
                    `<i class="fa-solid fa-check"></i> <span>No jobs running</span>`;
                if (this.state.isScanning === true) {
                    this.loadLabels()
                        .then(() => this.loadUntaggedCount())
                        .then(() => this.renderLabelPanel())
                        .catch(e => console.error('Label refresh after scan:', e));
                }
                this.state.isScanning = false;
            } else {
                const totalWavs     = data.total_wavs || 0;
                const foldersQueued = data.folders_queued || 0;
                const processed     = totalWavs - (data.wavs_queued || 0);
                let msg = `Scanning ${processed} of ${totalWavs}`;
                if (foldersQueued > 0) msg += ` (queued ${foldersQueued} items)`;
                this.elements.scanStatus.innerHTML =
                    `<i class="fa-solid fa-spinner fa-spin"></i> <span>${msg}</span>`;
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
            this._pushHistory(data);
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
            this._pushHistory(data);

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
            this._pushHistory(data);
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

    loadPrevHistory(playInstantly = false) {
        if (this.state.historyIndex <= 0) { console.log("No more history"); return; }
        this.state.historyIndex--;
        const snapshot = this.state.historyQueue[this.state.historyIndex];
        this.updateUI(snapshot, playInstantly);
    },


    updateUI(data, playInstantly = false) {
        this.elements.indexInput.classList.remove('error');

        // Hydrate every piece of state that identifies the current sample; kept together so
        // nothing is accidentally left stale when a new sample replaces the previous one.
        this.state.currentSampleId = data.id;
        this.state.currentDigest = data.digest;
        this.state.totalDuration = data.duration;
        this.state.sampleRate = data.samplerate;
        this.state.durationSamples = data.duration_samples;
        this._setOriginOffset(data.start_offset);
        this.state.currentOffset = data.start_offset;
        this.state.sampleName = data.name;
        this.state.sampleDir = data.directory;

        this.elements.indexInput.value = data.index_num;
        this.truncatePathLeft(this.elements.sampleName, data.name);
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

        this.state.markersDirty = true;
        this.loadMarkers(data.id).catch(e => console.error(e));
    },

    async disableMutable() {
        const res = await fetch('/api/mutable/disable', { method: 'POST' });
        if (!res.ok) return;
        this.state.mutable = false;
        this.elements.mutableIndicator.classList.add('disabled');
        document.getElementById('controls-archive-row')?.remove();
        document.getElementById('controls-cut-row')?.remove();
        this.showToast('Mutable options (archiving, writing) are disabled');
    },

    async enableMutable() {
        const res = await fetch('/api/mutable/enable', { method: 'POST' });
        if (!res.ok) return;
        this.state.mutable = true;
        this.elements.mutableIndicator.classList.remove('disabled');
        this.showToast('Mutable options (archiving, writing) are enabled');
    },

    // ------------------------------------------------------------------
    // Markers
    // ------------------------------------------------------------------

    async loadMarkers(sampleId) {
        this.state.markers          = [];
        this.state.activeMarkerIndex = -1;
        try {
            const res = await fetch(`/api/sample/${sampleId}/markers`);
            if (res.ok) {
                const data = await res.json();
                this.state.markers = data.markers || [];
            }
        } catch (e) {
            console.error('Failed to load markers', e);
        }
        this.renderMarkers();
    },

    renderMarkersInContainer(container, readonly = false) {
        container.querySelectorAll('.marker-line').forEach(el => el.remove());
        if (!this.state.durationSamples) return;
        const ns = 'http://www.w3.org/2000/svg';
        this.state.markers.forEach((marker, index) => {
            const pct  = (marker.offset / this.state.durationSamples) * 100;
            const line = document.createElement('div');
            line.className = 'marker-line ' + (index === this.state.activeMarkerIndex ? 'active' : 'pinned');
            line.style.left = pct + '%';

            const handle = document.createElement('div');
            handle.className = 'marker-handle';

            // Pentagon pin: rectangle body (1.5–17 px) + downward point (→ 23.5 px)
            const svg  = document.createElementNS(ns, 'svg');
            svg.setAttribute('width', '22');
            svg.setAttribute('height', '25');
            svg.setAttribute('viewBox', '0 0 22 25');
            svg.classList.add('marker-pin-svg');

            const poly = document.createElementNS(ns, 'polygon');
            poly.setAttribute('points', '1.5,1.5 20.5,1.5 20.5,17 11,23.5 1.5,17');
            poly.classList.add('marker-pin-shape');

            const txt = document.createElementNS(ns, 'text');
            txt.setAttribute('x', '11');
            txt.setAttribute('y', '9.25');
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('dominant-baseline', 'central');
            txt.classList.add('marker-pin-label');
            txt.textContent = String(index + 1);

            svg.appendChild(poly);
            svg.appendChild(txt);
            handle.appendChild(svg);

            const delX = document.createElement('i');
            delX.className = 'fa-solid fa-trash marker-delete-x';
            handle.appendChild(delX);

            line.appendChild(handle);
            container.appendChild(line);

            if (!readonly) {
                handle.addEventListener('mousedown', (e) => { e.stopPropagation(); });
                handle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.activateMarker(index);
                });
                delX.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteMarker(index).catch(err => console.error(err));
                });
            }
        });
    },

    renderMarkers() {
        this.renderMarkersInContainer(this.elements.waveformContainer);
    },

    activateMarker(index) {
        const marker = this.state.markers[index];
        if (!marker) return;
        this.state.activeMarkerIndex = index;
        this._beginSeekTo(marker.offset);
        this.state.currentOffset = marker.offset;
        this.elements.audio.currentTime = marker.offset / this.state.sampleRate;
        this.updateOffsetDisplay(marker.offset);
        this.updatePlayhead();
        this.flashPlayhead();
        this._resumeIfPlaying();
        setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
        this.renderMarkers();
    },

    async deleteMarker(index) {
        if (this._transientPending) {
            this.showErrorToast('Transient for marker is being calculated, please wait');
            return;
        }
        const marker = this.state.markers[index];
        if (!marker || !this.state.currentSampleId) return;
        const res = await fetch(
            `/api/sample/${this.state.currentSampleId}/markers/${marker.offset}`,
            { method: 'DELETE' }
        );
        if (!res.ok) return;
        this.state.markers.splice(index, 1);
        if (this.state.activeMarkerIndex === index) {
            this.state.activeMarkerIndex = -1;
        } else if (this.state.activeMarkerIndex > index) {
            this.state.activeMarkerIndex--;
        }
        this.state.markersDirty = true;
        this.renderMarkers();
    },

    promptDeleteAllMarkers() {
        if (!this.state.markers.length) return;
        if (this._transientPending) {
            this.showErrorToast('Transient for marker is being calculated, please wait');
            return;
        }
        this.elements.deleteMarkersOverlay.classList.remove('hidden');
    },

    async deleteAllMarkers() {
        if (!this.state.currentSampleId) return;
        const res = await fetch(`/api/sample/${this.state.currentSampleId}/markers`, { method: 'DELETE' });
        if (!res.ok) { this.showToast('Failed to delete markers'); return; }
        this.state.markers = [];
        this.state.activeMarkerIndex = -1;
        this.state.markersDirty = true;
        this.renderMarkers();
    },

    async _toggleMarkerAtOrigin() {
        const offset = this.state.originalStartOffset;
        const idx    = this.state.markers.findIndex(m => m.offset === offset);
        if (idx !== -1) {
            await this.deleteMarker(idx);
        } else {
            await this._addMarkerAtOffset(offset);
        }
    },

    async _addMarkerAtOffset(offset) {
        if (!this.state.currentSampleId) return;
        if (this.state.markers.length >= 32) {
            this.showToast('Maximum marker limit reached');
            return;
        }
        const res = await fetch(`/api/sample/${this.state.currentSampleId}/markers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offset }),
        });
        if (res.status === 409) return; // already exists at this offset
        if (res.status === 422) { this.showToast('Maximum marker limit reached'); return; }
        if (!res.ok) return;
        const data  = await res.json();
        const entry = { id: data.id, offset: data.offset };
        const idx   = this.state.markers.findIndex(m => m.offset > offset);
        if (idx === -1) {
            this.state.markers.push(entry);
            this.state.activeMarkerIndex = this.state.markers.length - 1;
        } else {
            this.state.markers.splice(idx, 0, entry);
            this.state.activeMarkerIndex = idx;
        }
        this.state.markersDirty = true;
        this.renderMarkers();
    },

    async _addMarkerAtClick(clientX) {
        if (!this.state.currentSampleId || !this.state.durationSamples) return;
        const rect     = this.elements.waveformContainer.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const offset   = Math.round(fraction * this.state.durationSamples);
        // Skip if within ±4 px of an existing marker handle
        for (const line of this.elements.waveformContainer.querySelectorAll('.marker-line')) {
            const lx = parseFloat(line.style.left) / 100 * rect.width + rect.left;
            if (Math.abs(clientX - lx) <= 4) return;
        }
        await this._addMarkerAtOffset(offset);
    },

    _shiftClickWaveform(clientX) {
        if (!this.state.currentSampleId || !this.state.durationSamples) return;
        const rect     = this.elements.waveformContainer.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const clicked  = Math.round(fraction * this.state.durationSamples);

        if (this.state.markers.length === 0) {
            this.seekToWaveformClick(clientX, true);
            return;
        }
        let markerIdx  = -1;
        let playOffset = 0;
        for (let i = this.state.markers.length - 1; i >= 0; i--) {
            if (this.state.markers[i].offset <= clicked) {
                markerIdx  = i;
                playOffset = this.state.markers[i].offset;
                break;
            }
        }
        this.state.activeMarkerIndex = markerIdx;
        this._beginSeekTo(playOffset);
        this.state.currentOffset      = playOffset;
        this.state.skipEndedEvent     = true;
        this.elements.audio.currentTime = playOffset / this.state.sampleRate;
        this.updateOffsetDisplay(playOffset);
        this.updatePlayhead();
        this.flashPlayhead();
        this._startPlaying();
        setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
        this.renderMarkers();
    },

    navigateToNextMarker(steps = 1) {
        if (!this.state.markers.length) { this.showToast('No pinned markers'); return; }
        const cur = this.state.currentOffset;
        let idx = this.state.markers.findIndex(m => m.offset > cur);
        if (idx === -1) idx = 0;
        for (let s = 1; s < steps; s++) {
            const next = idx + 1;
            idx = next < this.state.markers.length ? next : 0;
        }
        this.activateMarker(idx);
    },

    navigateToPrevMarker(steps = 1) {
        if (!this.state.markers.length) { this.showToast('No pinned markers'); return; }
        const cur = this.state.currentOffset;
        let idx = -1;
        for (let i = this.state.markers.length - 1; i >= 0; i--) {
            if (this.state.markers[i].offset < cur) { idx = i; break; }
        }
        if (idx === -1) idx = this.state.markers.length - 1;
        for (let s = 1; s < steps; s++) {
            const prev = idx - 1;
            idx = prev >= 0 ? prev : this.state.markers.length - 1;
        }
        this.activateMarker(idx);
    },

    async _replaceActiveMarker(newOffset) {
        const oldIdx   = this.state.activeMarkerIndex;
        const oldMarker = this.state.markers[oldIdx];
        if (!oldMarker || !this.state.currentSampleId) return;
        await fetch(
            `/api/sample/${this.state.currentSampleId}/markers/${oldMarker.offset}`,
            { method: 'DELETE' }
        );
        const res = await fetch(`/api/sample/${this.state.currentSampleId}/markers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offset: newOffset }),
        });
        if (!res.ok) return;
        const data  = await res.json();
        this.state.markers.splice(oldIdx, 1);
        const entry = { id: data.id, offset: newOffset };
        const idx   = this.state.markers.findIndex(m => m.offset > newOffset);
        if (idx === -1) {
            this.state.markers.push(entry);
            this.state.activeMarkerIndex = this.state.markers.length - 1;
        } else {
            this.state.markers.splice(idx, 0, entry);
            this.state.activeMarkerIndex = idx;
        }
        this._beginSeekTo(newOffset);
        this.state.currentOffset = newOffset;
        this.elements.audio.currentTime = newOffset / this.state.sampleRate;
        this.updateOffsetDisplay(newOffset);
        this.updatePlayhead();
        this.state.markersDirty = true;
        this.renderMarkers();
        this._resumeIfPlaying();
        setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
    },

    // ------------------------------------------------------------------
    // Marker splits
    // ------------------------------------------------------------------

    _updateSplitButtonGating() {
        const val = parseInt(this.elements.markerCount.value, 10);
        const enabled = !isNaN(val) && val >= 1;
        this.elements.btnSetLinear.disabled = !enabled;
        this.elements.btnSetRandom.disabled = !enabled;
    },

    _confirmOverwrite() {
        return new Promise(resolve => {
            this._pendingSplitResolve = resolve;
            this.elements.overwriteMarkersOverlay.classList.remove('hidden');
        });
    },

    async applyMarkerSplit(mode) {
        const count = parseInt(this.elements.markerCount.value, 10);
        if (isNaN(count) || count < 1) return;
        if (!this.state.currentSampleId) return;

        if (this.state.markersDirty && this.state.markers.length > 0) {
            const confirmed = await this._confirmOverwrite();
            if (!confirmed) return;
        }

        const res = await fetch(`/api/sample/${this.state.currentSampleId}/markers/${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count }),
        });
        if (!res.ok) {
            this.showToast('Failed to apply marker split');
            return;
        }
        const data = await res.json();
        this.state.markers = (data.markers || []).map((off, i) => ({ id: i, offset: off }));
        this.state.activeMarkerIndex = -1;
        this.state.markersDirty = false;
        this.renderMarkers();
    },

    // ------------------------------------------------------------------
    // Cut dialog (marker-aware)
    // ------------------------------------------------------------------

    _renderCutDialog() {
        const sampleId   = this.state.currentSampleId;
        const numRegions = this.state.markers.length + 1;

        this.elements.cutDialogWaveform.src = `/waveform/${sampleId}?t=${Date.now()}`;

        const wrap = this.elements.cutWaveformWrap;
        wrap.querySelectorAll('.cut-region').forEach(el => el.remove());
        this.renderMarkersInContainer(wrap, true);

        this._cutState = { regionActive: new Array(numRegions).fill(true) };
        this._renderCutRegions(wrap);
        this._updateCutOkState();
    },

    _renderCutRegions(container) {
        container.querySelectorAll('.cut-region').forEach(el => el.remove());
        const markers    = this.state.markers;
        const duration   = this.state.durationSamples;
        const boundaries = [0, ...markers.map(m => m.offset), duration];

        for (let i = 0; i < boundaries.length - 1; i++) {
            const start    = boundaries[i];
            const end      = boundaries[i + 1];
            const leftPct  = (start / duration) * 100;
            const widthPct = ((end - start) / duration) * 100;
            const isActive = this._cutState.regionActive[i];

            const region = document.createElement('div');
            region.className   = 'cut-region ' + (isActive ? 'cut-region-active' : 'cut-region-inactive');
            region.dataset.idx = i;
            region.style.left  = leftPct + '%';
            region.style.width = widthPct + '%';
            region.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(region.dataset.idx);
                this._cutState.regionActive[idx] = !this._cutState.regionActive[idx];
                this._renderCutRegions(container);
                this._updateCutOkState();
                this._updateCutRegionStatus();
                this.elements.cutDialogOk.focus();
            });
            container.appendChild(region);
        }
        this._updateCutRegionStatus();
    },

    _updateCutRegionStatus() {
        const el = document.getElementById('cut-region-status');
        if (!el) return;
        const total  = this._cutState.regionActive ? this._cutState.regionActive.length : 0;
        const active = this._cutState.regionActive ? this._cutState.regionActive.filter(Boolean).length : 0;
        if (active === total) {
            el.textContent = 'All sections will be cut to new samples';
        } else if (active === 0) {
            el.textContent = 'No sections selected — select at least one to keep';
        } else {
            el.textContent = `${active} of ${total} sections will be cut to new samples`;
        }
    },

    // ------------------------------------------------------------------
    // Export via job queue
    // ------------------------------------------------------------------

    async downloadSlice() {
        if (!this.state.currentSampleId) return;
        const checkRes = await fetch(
            `/api/jobs?sample_id=${this.state.currentSampleId}&type=export`
        ).catch(() => null);
        if (checkRes && checkRes.ok) {
            const jobs   = await checkRes.json();
            const active = jobs.filter(j => j.status === 'queued' || j.status === 'running');
            if (active.length > 0) { this.showToast('Export already in progress'); return; }
        }
        const markers = this.state.markers.map(m => m.offset);
        const body = {
            sample_id:      this.state.currentSampleId,
            start_offset:   this.state.originalStartOffset,
            pitch_semitones: this.state.pitchSemitones,
            pitch_cents:    this.state.pitchCents,
            markers,
        };
        const res = await fetch('/api/jobs/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).catch(() => null);
        if (!res || !res.ok) {
            const data = res ? await res.json().catch(() => ({})) : {};
            this.showToast(data.error === 'sample_busy' ? 'Export already in progress' : 'Export failed');
            return;
        }
        const { job_id } = await res.json();
        this.showToast(markers.length ? 'Export started — preparing ZIP…' : 'Export started…');
        this._pollExportJob(job_id);
    },

    _pollExportJob(jobId) {
        const poll = async () => {
            try {
                const res  = await fetch(`/api/jobs/${jobId}`);
                if (!res.ok) { this.showToast('Export check failed'); return; }
                const data = await res.json();
                if (data.status === 'done' && data.result_ready) {
                    window.location.href = `/api/jobs/${jobId}/download`;
                } else if (data.status === 'failed') {
                    this.showToast(`Export failed: ${data.error || 'unknown error'}`);
                } else {
                    setTimeout(poll, 1000);
                }
            } catch (e) { console.error('Export poll:', e); }
        };
        setTimeout(poll, 500);
    },

    promptArchiveSample() {
        const name = this.state.sampleName;
        if (!name) return;

        if (this.state.isPlaying) {
            this.elements.audio.pause();
            this._stopPlayheadUpdater();
            this.state.isPlaying = false;
            this.updateStatusText('STOPPED');
        }

        const bak = name + '.bak';
        const msg = this.elements.archiveDialogMsg;
        const bold = t => { const b = document.createElement('strong'); b.textContent = t; return b; };
        msg.innerHTML = '';
        msg.appendChild(document.createTextNode('Are you sure you want to archive sample?'));
        msg.appendChild(document.createElement('br'));
        msg.appendChild(document.createElement('br'));
        msg.appendChild(document.createTextNode('Sample will be renamed to:'));
        msg.appendChild(document.createElement('br'));
        msg.appendChild(bold(bak));
        setTimeout(() => {
            this.elements.archiveDialogOverlay.classList.remove('hidden');
            this.elements.archiveDialogOk.focus();
        }, 200);
    },

    async archiveSample() {
        const sampleId = this.state.currentSampleId;
        const name     = this.state.sampleName;
        if (!sampleId) return;

        const res = await fetch('/api/jobs/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sample_id: sampleId }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            if (body.error === 'sample_busy') {
                this.showToast('A job on this sample is scheduled, please wait');
            } else {
                this.showToast(`Archive failed: ${body.error || res.status}`);
            }
            return;
        }
        this.showToast(`Archive queued: "${name}" will be renamed to "${name}.bak"`);
        await this._postArchiveRefresh();
    },

    _updateCutOkState() {
        const anyActive = this._cutState.regionActive && this._cutState.regionActive.some(Boolean);
        this.elements.cutDialogOk.disabled = !anyActive;
    },

    _closeCutDialog() {
        this.elements.cutDialogOverlay.classList.add('hidden');
    },

    async _postArchiveRefresh(navigate = true) {
        await this.pollStatus();
        await this.loadLabels();
        await this.loadUntaggedCount();
        this.renderLabelPanel();
        const activeQpId = this.state.quickpick.activePresetId;
        if (activeQpId) {
            await this.loadQuickpickSlots(activeQpId);
            this.renderQuickpickBar();
        }
        if (navigate) {
            await this.loadNextRandom(this.state.isPlaying || this.state.playInstantly);
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
            this.state.maxMarkers = data.max_markers ?? 32;
            if (data.version) {
                this.state.appVersion = 'v' + data.version;
                this.elements.appVersion.textContent = this.state.appVersion;
            }
            this.state.mutable = !!data.mutable;
            this.elements.mutableIndicator.classList.remove('hidden');
            if (this.state.mutable) {
                this.elements.mutableIndicator.classList.remove('disabled');
            } else {
                this.elements.mutableIndicator.classList.add('disabled');
            }
        } catch (e) {
            console.error('Failed to load info', e);
        }
    },

    addEventListeners() {
        this.elements.themeSelect.addEventListener('change', (e) => this.changeTheme(e.target.value));
        this.elements.loopBtn.addEventListener('click', () => this.toggleLoop());
        document.getElementById('controls-help-btn').addEventListener('click', () => this.toggleControlsDialog());
        document.getElementById('controls-dialog-close').addEventListener('click', () => this.toggleControlsDialog());
        this.elements.controlsDialogOverlay.addEventListener('click', (e) => {
            if (e.target === this.elements.controlsDialogOverlay) this.toggleControlsDialog();
        });

        this.elements.waveformContainer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.ctrlKey) {
                e.preventDefault();
                this._addMarkerAtClick(e.clientX).catch(err => console.error(err));
            } else if (e.shiftKey) {
                e.preventDefault();
                this._shiftClickWaveform(e.clientX);
            } else {
                this.state.activeMarkerIndex = -1;
                this.seekToWaveformClick(e.clientX, false);
                this.renderMarkers();
            }
        });

        this.elements.waveformContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.state.activeMarkerIndex = -1;
            this.seekToWaveformClick(e.clientX, true);
            this.renderMarkers();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control') this.elements.waveformContainer.classList.add('ctrl-active');
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') this.elements.waveformContainer.classList.remove('ctrl-active');
        });
        // Also clear on blur so releasing Ctrl outside the window doesn't leave handles stuck
        window.addEventListener('blur', () => {
            this.elements.waveformContainer.classList.remove('ctrl-active');
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
                    if (this.state.activeMarkerIndex >= 0 &&
                        this.state.markers[this.state.activeMarkerIndex]?.offset !== newOffset) {
                        this._replaceActiveMarker(newOffset).catch(err => console.error(err));
                        return;
                    }
                    this._setOriginOffset(newOffset);
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

        // Refresh button
        this.elements.refreshBtn.addEventListener('click', () => this._doRefresh().catch(e => console.error(e)));

        // Blur panel icon buttons after click so keyboard shortcuts remain active
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.panel-icon-btn');
            if (btn) btn.blur();
        });

        this.elements.mutableIndicator.addEventListener('click', () => {
            if (this.state.mutable) {
                this.disableMutable().catch(err => console.error(err));
            } else if (this.state.mutableWarn) {
                this.elements.mutableWarnOverlay.classList.remove('hidden');
            } else {
                this.enableMutable().catch(err => console.error(err));
            }
        });

        const _closeMutableWarnDialog = () => this.elements.mutableWarnOverlay.classList.add('hidden');
        this.elements.mutableWarnCancel.addEventListener('click', _closeMutableWarnDialog);
        this.elements.mutableWarnClose.addEventListener('click', _closeMutableWarnDialog);
        this.elements.mutableWarnOk.addEventListener('click', () => {
            _closeMutableWarnDialog();
            this.state.mutableWarn = false;
            this.saveConfig('mutable-warn', 'false');
            this.enableMutable().catch(err => console.error(err));
        });

        const _closeArchiveDialog = () => this.elements.archiveDialogOverlay.classList.add('hidden');
        this.elements.archiveDialogCancel.addEventListener('click', _closeArchiveDialog);
        this.elements.archiveDialogClose.addEventListener('click', _closeArchiveDialog);
        this.elements.archiveDialogOk.addEventListener('click', () => {
            _closeArchiveDialog();
            this.archiveSample().catch(err => console.error(err));
        });

        const _closeDeleteMarkersDialog = () => this.elements.deleteMarkersOverlay.classList.add('hidden');
        this.elements.deleteMarkersCancel.addEventListener('click', _closeDeleteMarkersDialog);
        this.elements.deleteMarkersClose.addEventListener('click', _closeDeleteMarkersDialog);
        this.elements.deleteMarkersOk.addEventListener('click', () => {
            _closeDeleteMarkersDialog();
            this.deleteAllMarkers().catch(err => console.error(err));
        });

        // Overwrite markers dialog
        const _resolveOverwrite = (confirmed) => {
            this.elements.overwriteMarkersOverlay.classList.add('hidden');
            if (this._pendingSplitResolve) {
                this._pendingSplitResolve(confirmed);
                this._pendingSplitResolve = null;
            }
        };
        this.elements.overwriteMarkersOk.addEventListener('click', () => _resolveOverwrite(true));
        this.elements.overwriteMarkersCancel.addEventListener('click', () => _resolveOverwrite(false));
        this.elements.overwriteMarkersClose.addEventListener('click', () => _resolveOverwrite(false));

        // Marker count combobox
        this.elements.markerCount.addEventListener('click', () => {
            this.elements.markerCountDropdown.classList.toggle('hidden');
        });
        this.elements.markerCount.addEventListener('input', () => {
            this.elements.markerCount.value = this.elements.markerCount.value.replace(/\D/g, '');
            this._updateSplitButtonGating();
        });
        this.elements.markerCount.addEventListener('blur', () => {
            const val = parseInt(this.elements.markerCount.value, 10);
            if (isNaN(val) || val < 0 || val > this.state.maxMarkers) {
                this.elements.markerCount.value = '0';
            }
            this._updateSplitButtonGating();
        });
        this.elements.markerCountDropdown.addEventListener('click', (e) => {
            const li = e.target.closest('li[data-value]');
            if (!li) return;
            this.elements.markerCount.value = li.dataset.value;
            this.elements.markerCountDropdown.classList.add('hidden');
            this._updateSplitButtonGating();
        });
        document.addEventListener('click', (e) => {
            if (!this.elements.markerCount.parentElement.contains(e.target)) {
                this.elements.markerCountDropdown.classList.add('hidden');
            }
        });

        // Split buttons
        this.elements.btnSetLinear.addEventListener('click', () => this.applyMarkerSplit('linear').catch(err => console.error(err)));
        this.elements.btnSetRandom.addEventListener('click', () => this.applyMarkerSplit('random').catch(err => console.error(err)));

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Escape') {
                if (this.state.controlsDialogOpen) {
                    this.toggleControlsDialog();
                    return;
                }
                if (!this.elements.mutableWarnOverlay.classList.contains('hidden')) {
                    _closeMutableWarnDialog();
                    return;
                }
                if (!this.elements.cutDialogOverlay.classList.contains('hidden')) {
                    this._closeCutDialog();
                    return;
                }
                if (!this.elements.archiveDialogOverlay.classList.contains('hidden')) {
                    _closeArchiveDialog();
                    return;
                }
                if (!this.elements.deleteMarkersOverlay.classList.contains('hidden')) {
                    this.elements.deleteMarkersOverlay.classList.add('hidden');
                    return;
                }
                if (!this.elements.overwriteMarkersOverlay.classList.contains('hidden')) {
                    _resolveOverwrite(false);
                    return;
                }
                if (!this.elements.manageFoldersOverlay.classList.contains('hidden')) {
                    this.closeManageFoldersDialog();
                    return;
                }
                if (!this.elements.folderDialogOverlay.classList.contains('hidden')) {
                    this.closeFolderDialog();
                    return;
                }
            }
            if (e.key === '?') {
                e.preventDefault();
                this.toggleControlsDialog();
                return;
            }
            const tag = document.activeElement.tagName;
            if (tag === 'SELECT' || tag === 'BUTTON' || tag === 'INPUT') return;

            if (e.code === 'Home') {
                e.preventDefault();
                this.seekToStart();
            } else if (e.code === 'Space') {
                e.preventDefault();
                if (e.ctrlKey) this.markStartOffset();
                else if (e.shiftKey) this.restartPlay();
                else this.togglePlay();
            } else if (e.code === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this._addMarkerAtOffset(this.state.currentOffset).catch(err => console.error(err));
            } else if (e.code === 'KeyM') {
                e.preventDefault();
                this._toggleMarkerAtOrigin().catch(err => console.error(err));
            } else if (e.code === 'KeyD') {
                e.preventDefault();
                this.promptDeleteAllMarkers();
            } else if (e.code === 'KeyU' && e.ctrlKey) {
                e.preventDefault();
                this.copyCurrentUrlToClipboard();
            } else if (e.code === 'KeyL' && e.shiftKey) {
                this.applyMarkerSplit('random').catch(err => console.error(err));
            } else if (e.code === 'KeyL') {
                this.applyMarkerSplit('linear').catch(err => console.error(err));
            } else if (e.code === 'KeyR') {
                this._clearFocusedQpSlot();
                const autoPlay = this.state.isPlaying || this.state.playInstantly;
                if (e.shiftKey) this.randomizeCurrentOffset(autoPlay).catch(err => console.error(err));
                else this.loadNextRandom(autoPlay).catch(err => console.error(err));
            } else if (e.code === 'KeyP') {
                this._clearFocusedQpSlot();
                this.loadPrevHistory(this.state.isPlaying || this.state.playInstantly);
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
            } else if (e.key === '/') {
                this.resetPitch();
            } else if (e.code === 'KeyV') {
                this.storeToNextFreeQpSlot().catch(err => console.error(err));
            } else if (e.code === 'KeyT') {
                this.findAndSnapToTransient(e.shiftKey).catch(err => console.error(err));
            } else if (e.code === 'KeyA' && this.state.mutable && !e.ctrlKey && !e.shiftKey) {
                this.promptArchiveSample();
            } else if (e.code === 'KeyC' && this.state.mutable && !e.ctrlKey && !e.shiftKey) {
                if (this.elements.cutDialogOverlay.classList.contains('hidden')) {
                    this.showCutDialog().catch(err => console.error(err));
                }
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                this.navigateToPrevMarker(e.shiftKey ? 2 : 1);
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                this.navigateToNextMarker(1);
            } else if (e.code === 'KeyJ') {
                e.preventDefault();
                this.navigateQuickpickSlot(-1);
            } else if (e.code === 'KeyK') {
                e.preventDefault();
                this.navigateQuickpickSlot(1);
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

        this.elements.btnFindTransient.addEventListener('click', (e) => this.findAndSnapToTransient(e.shiftKey).catch(err => console.error(err)));

        this.elements.cutDialogClose .addEventListener('click', () => this._closeCutDialog());
        this.elements.cutDialogCancel.addEventListener('click', () => this._closeCutDialog());
        this.elements.cutDialogOk    .addEventListener('click', () => this._commitCut().catch(err => console.error(err)));

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
        this.elements.folderManageBtn.addEventListener('click', () => this.openManageFoldersDialog().catch(e => console.error(e)));

        // Folder add dialog
        this.elements.folderDialogClose.addEventListener('click', () => this.closeFolderDialog());
        this.elements.folderDialogCancel.addEventListener('click', () => this.closeFolderDialog());
        this.elements.folderDialogOk.addEventListener('click', () => this.submitFolderDialog().catch(e => console.error(e)));

        // Manage scan folders dialog
        document.getElementById('manage-folders-close').addEventListener('click', () => this.closeManageFoldersDialog());
        document.getElementById('manage-folders-cancel').addEventListener('click', () => this.closeManageFoldersDialog());
        document.getElementById('manage-folders-ok').addEventListener('click', () => this._submitManageFoldersDialog().catch(e => console.error(e)));

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
        this.elements.qpCloneBtn.addEventListener('click', () => {
            this.elements.qpCloneBtn.blur();
            this.cloneQuickpickPreset().catch(e => console.error(e));
        });
        this.elements.qpDeleteBtn.addEventListener('click', () => {
            this.elements.qpDeleteBtn.blur();
            this.deleteQuickpickPreset().catch(e => console.error(e));
        });

        this.elements.qpPresetSelect.addEventListener('change', async () => {
            const val = this.elements.qpPresetSelect.value;
            const presetId = val ? parseInt(val) : null;

            this._resetQuickpickState(presetId);

            if (presetId) {
                await this.loadQuickpickSlots(presetId);
                await this.saveConfig('quick-pick-preset', String(presetId));
                const firstSlot = [1,2,3,4,5,6,7,8,9,10].find(n => !!this.state.quickpick.slots[String(n)]);
                if (firstSlot !== undefined) this.state.quickpick.focusedSlot = firstSlot;
            } else {
                await this.saveConfig('quick-pick-preset', '');
            }
            this.renderQuickpickBar();
            this.elements.qpPresetSelect.blur();
            if (this.state.quickpick.focusedSlot !== null) {
                await this.recallQuickpickSlot(this.state.quickpick.focusedSlot);
            }
        });

        this.elements.qpRenameBtn.addEventListener('click', () => {
            this.elements.qpRenameBtn.blur();
            this.startQuickpickRename();
        });

        this.elements.qpPlayInstantly.addEventListener('change', () => {
            this.state.playInstantly = this.elements.qpPlayInstantly.checked;
            this.elements.qpPlayInstantly.blur();
            this.saveConfig('quick-play-instantly', String(this.state.playInstantly)).catch(e => console.error(e));
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
                this.state.currentOffset = 0;
                this.elements.audio.currentTime = 0;
                this.updatePlayhead();
                this.updateStatusText('STOPPED');
            }
        });
    },
};
