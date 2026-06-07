// -----------------------------------------------------------------------
// Audio playback, playhead, pitch
// -----------------------------------------------------------------------

Object.assign(GrooveDropper, {

    // Updates the play/stop icon and styling of the status indicator.
    updateStatusText(status) {
        const icon = this.elements.playStatus.querySelector('i');
        const playing = status === 'PLAYING';
        icon.className = playing ? 'fa-solid fa-play' : 'fa-solid fa-stop';
        this.elements.playStatus.className = playing ? 'playing' : '';
    },

    // Starts a rAF loop that keeps state.currentOffset in sync with the audio element's position.
    _startPlayheadUpdater() {
        cancelAnimationFrame(this._rafId);
        const tick = () => {
            this.state.currentOffset = Math.round(this.elements.audio.currentTime * this.state.sampleRate);
            this.updatePlayhead();
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    },

    // Cancels the rAF playhead updater loop.
    _stopPlayheadUpdater() {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
    },

    // Positions the mark-cut dotted line at the reset origin (originalStartOffset).
    updateMarkCut() {
        if (this.state.durationSamples > 0) {
            this.elements.markCut.style.left =
                `${(this.state.originalStartOffset / this.state.durationSamples) * 100}%`;
        }
    },

    // Sets originalStartOffset and syncs the mark-cut marker in one call.
    _setOriginOffset(offset) {
        this.state.originalStartOffset = offset;
        this.updateMarkCut();
    },

    // Briefly adds the 'flash' class to the playhead element to animate a visual cue.
    flashPlayhead() {
        this.elements.playhead.classList.add('flash');
        setTimeout(() => this.elements.playhead.classList.remove('flash'), 100);
    },

    // Moves the playhead element to the position corresponding to state.currentOffset.
    updatePlayhead() {
        if (this.state.durationSamples > 0) {
            this.elements.playhead.style.left =
                `${(this.state.currentOffset / this.state.durationSamples) * 100}%`;
        }
    },

    // Starts audio from stopped state: plays, sets isPlaying, updates status, starts rAF.
    _startPlaying() {
        this.elements.audio.play();
        this.state.isPlaying = true;
        this.updateStatusText('PLAYING');
        this._startPlayheadUpdater();
    },

    // Restarts the rAF updater and resumes audio if currently playing (used after a seek).
    _resumeIfPlaying() {
        if (this.state.isPlaying) {
            this._stopPlayheadUpdater();
            this.elements.audio.play();
            this._startPlayheadUpdater();
        }
    },

    // Toggles playback: pauses and records the current offset, or resumes from it.
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
            this._startPlaying();
            setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
        }
    },

    // Prepares a seek: records the new canonical offset and suppresses the 'ended' event
    // that the seek itself may fire. Both originalStartOffset and currentOffset must always
    // move together so history and playback both reference the same position.
    _beginSeekTo(offset) {
        this._setOriginOffset(offset);
        this.state.currentOffset = offset;
        this.state.skipEndedEvent = true;
    },

    // Seeks back to the active pinned marker (if any) or the original start offset.
    restartPlay() {
        if (!this.state.currentSampleId)
            return;

        this.elements.indexInput.classList.remove('error');

        const marker = this.state.activeMarkerIndex >= 0
            ? this.state.markers[this.state.activeMarkerIndex]
            : null;
        const restartOffset = marker ? marker.offset : this.state.originalStartOffset;

        this.state.currentOffset  = restartOffset;
        this.state.skipEndedEvent = true;
        this.elements.audio.currentTime = restartOffset / this.state.sampleRate;

        this.updateOffsetDisplay(restartOffset);
        this.updatePlayhead();
        this.flashPlayhead();

        this._resumeIfPlaying();
        setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
    },

    // Seeks to the absolute beginning of the sample (offset 0) and resumes if playing.
    seekToStart() {
        if (!this.state.currentSampleId)
            return;

        this._beginSeekTo(0);

        this.elements.audio.currentTime = 0;
        this.updateOffsetDisplay(0);
        this.updatePlayhead();
        this.flashPlayhead();
        this._resumeIfPlaying();
        setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
    },

    // Asks the API for a new random offset within the current sample and seeks to it.
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

            this._beginSeekTo(data.start_offset);

            this.elements.audio.currentTime = data.start_offset / this.state.sampleRate;
            this.updateOffsetDisplay(data.start_offset);
            this.updatePlayhead();
            this.flashPlayhead();

            if (playInstantly && !this.state.isPlaying) {
                this._startPlaying();
            } else if (this.state.isPlaying) {
                this.elements.audio.play();
            }
            setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
        } catch (e) {
            console.error("Error calling randomize API:", e);
        }
    },

    // Seeks to the waveform position under the click, optionally starting playback.
    seekToWaveformClick(clientX, startPlaying) {
        if (!this.state.currentSampleId || this.state.durationSamples <= 0) return;
        this.elements.indexInput.classList.remove('error');

        const rect = this.elements.waveformContainer.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newOffset = Math.round(fraction * this.state.durationSamples);

        this._setOriginOffset(newOffset);
        this.state.currentOffset = newOffset;

        const shouldPlay = startPlaying || this.state.isPlaying;
        this.state.skipEndedEvent = true;
        this.elements.audio.pause();
        this.elements.audio.currentTime = newOffset / this.state.sampleRate;
        this.updateOffsetDisplay(newOffset);
        this.updatePlayhead();
        this.flashPlayhead();

        if (shouldPlay) {
            if (this.state.isPlaying) {
                this.elements.audio.play();
            } else {
                this._startPlaying();
            }
        }
        setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
    },

    // downloadSlice is defined in app.js (job-based, async, marker-aware).

    // Sets the audio element's playbackRate to match the current semitone + cent pitch state.
    _applyPitch() {
        const total = this.state.pitchSemitones + this.state.pitchCents / 100;
        const rate = Math.pow(2, total / 12);
        this.elements.audio.preservesPitch = false;
        this.elements.audio.defaultPlaybackRate = rate;
        this.elements.audio.playbackRate = rate;
    },

    // Refreshes the semitone/cents drag labels and toggles the pitch-active badge class.
    _renderPitchOverlay() {
        const s = this.state.pitchSemitones;
        const c = this.state.pitchCents;
        this.elements.pitchSemitoneDrag.textContent = (s >= 0 ? '+' : '') + s;
        this.elements.pitchCentsDrag.textContent = c + 'c';
        this.elements.pitchBadge.classList.toggle('pitch-active', s !== 0 || c !== 0);
    },

    // Adds delta semitones and cents, carries over at ±100 cents, then applies and syncs to the focused slot.
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
        this._syncFocusedQpSlotPitch().catch(e => console.error(e));
    },

    // Marks the current playhead position as the new slice/restart origin without seeking.
    markStartOffset() {
        if (!this.state.currentSampleId) return;
        this._setOriginOffset(this.state.currentOffset);
        this.flashPlayhead();
    },

    // Resets semitones and cents to zero, applies the change, and syncs to the focused slot.
    resetPitch() {
        this.state.pitchSemitones = 0;
        this.state.pitchCents = 0;
        this._applyPitch();
        this._renderPitchOverlay();
        this._syncFocusedQpSlotPitch().catch(e => console.error(e));
    },

    // Scans forward from the current origin offset, snaps to the next transient zero-crossing.
    // bigOnly=true skips hi-hats (raises delta threshold, cuts high frequencies).
    // When an active pinned marker's offset matches the current begin position, the marker
    // is moved to the transient together with the begin offset playhead.
    async findAndSnapToTransient(bigOnly = false) {
        if (!this.state.currentSampleId) return;

        const activeIdx = this.state.activeMarkerIndex;
        const activeMarker = activeIdx >= 0 ? this.state.markers[activeIdx] : null;
        const isMarkerMode = !!(activeMarker && activeMarker.offset === this.state.originalStartOffset);

        this._transientPending = true;
        try {
            const res = await fetch('/api/find_transient', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sample_id:    this.state.currentSampleId,
                    start_sample: this.state.originalStartOffset,
                    big_only:     bigOnly,
                }),
            });
            const data = await res.json();

            if (!data.found) {
                this.showToast('no transient found');
                return;
            }

            const offset = data.zero_crossing_sample;
            if (isMarkerMode) {
                await this._replaceActiveMarker(offset);
                this.showToast('Transient set for marker');
            } else {
                this._beginSeekTo(offset);
                this.elements.audio.currentTime = offset / this.state.sampleRate;
                this.updateOffsetDisplay(offset);
                this.updatePlayhead();
                this.flashPlayhead();
                this._resumeIfPlaying();
                setTimeout(() => { this.state.skipEndedEvent = false; }, 50);
                this.showToast('transient found');
            }
        } finally {
            this._transientPending = false;
        }
    },

    async showCutDialog() {
        if (!this.state.currentSampleId || !this.state.mutable) return;

        if (!this.state.markers.length) {
            await this._addMarkerAtOffset(this.state.originalStartOffset);
        }

        // Guard: refuse if sample already has a queued/running job
        try {
            const res = await fetch(`/api/jobs?sample_id=${this.state.currentSampleId}`);
            if (res.ok) {
                const jobs   = await res.json();
                const active = jobs.filter(j => j.status === 'queued' || j.status === 'running');
                if (active.length > 0) {
                    this.showToast('A job on this sample is scheduled, please wait');
                    return;
                }
            }
        } catch (_) { /* non-fatal */ }

        if (this.state.isPlaying) {
            this.elements.audio.pause();
            this._stopPlayheadUpdater();
            this.state.isPlaying = false;
            this.updateStatusText('STOPPED');
        }

        this.elements.cutDialogOverlay.classList.remove('hidden');
        this._renderCutDialog();
        this.elements.cutDialogOk.focus();
    },

    async _commitCut() {
        const sampleIdAtCut = this.state.currentSampleId;
        this._closeCutDialog();

        const body = {
            sample_id:       sampleIdAtCut,
            markers:         this.state.markers.map(m => m.offset),
            regions_to_keep: this._cutState.regionActive
                .map((active, i) => (active ? i : -1))
                .filter(i => i >= 0),
        };

        const res = await fetch('/api/jobs/cut', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.error === 'sample_busy') {
                this.showToast('A job on this sample is scheduled, please wait');
            } else {
                this.showErrorToast(data.error || 'Cut failed');
            }
            return;
        }

        this.showToast('Cut job queued');
        await this._postArchiveRefresh(true);
    },

    // Attaches a vertical mouse-drag handler to el; each STEP_PX of drag calls onStep(±steps).
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

});
