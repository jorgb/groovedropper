// -----------------------------------------------------------------------
// Export dialog
// -----------------------------------------------------------------------

Object.assign(GrooveDropper, {

    // jobId → intervalId for every export currently being polled
    _activeExportJobs: new Map(),

    async showExportDialog() {
        // Reset to initial state
        const dropdown = document.getElementById('export-type-dropdown');
        const hint     = document.getElementById('export-no-selection-hint');
        const ok       = document.getElementById('export-dialog-ok');
        dropdown.value = '';
        hint.style.display = '';
        document.querySelectorAll('.export-panel').forEach(p => { p.style.display = 'none'; });
        ok.disabled = true;

        this.elements.exportDialogOverlay.classList.remove('hidden');
        dropdown.focus();
    },

    _closeExportDialog() {
        this.elements.exportDialogOverlay.classList.add('hidden');
    },

    _onExportTypeChange() {
        const dropdown = document.getElementById('export-type-dropdown');
        const hint     = document.getElementById('export-no-selection-hint');
        const ok       = document.getElementById('export-dialog-ok');

        hint.style.display = 'none';
        document.querySelectorAll('.export-panel').forEach(p => { p.style.display = 'none'; });

        const selected = dropdown.value;
        if (!selected) {
            ok.disabled = true;
            hint.style.display = '';
            return;
        }

        const panel = document.getElementById(`export-panel-${selected}`);
        if (panel) {
            panel.style.display = '';
            this._populateExportPanel(selected);
        }
        ok.disabled = false;
    },

    _populateExportPanel(mode) {
        if (mode === 'bytag') {
            const countEl = document.getElementById('export-bytag-count');
            if (countEl) countEl.textContent = this.state.totalSamplesCount;
        }
    },

    async _commitExport() {
        const dropdown = document.getElementById('export-type-dropdown');
        const mode     = dropdown.value;
        if (!mode) return;

        let payload = {};
        if (mode === 'bytag') {
            payload = {
                label_ids:      this.state.activePresetLabelIds || [],
                untagged:       this.state.untaggedFilterActive  || false,
                filter_mode:    this.state.activeFilterMode      || 'OR',
                preserve_paths: document.getElementById('export-preserve-paths').checked,
                archive_after:  document.getElementById('export-archive-after').checked,
            };
        }

        this._closeExportDialog();

        let res;
        try {
            res = await fetch(`/api/jobs/export_${mode}`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload),
            });
        } catch (err) {
            this.showErrorToast('Export failed: network error');
            return;
        }

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            this.showErrorToast(data.error || 'Export failed');
            return;
        }

        const { job_id } = await res.json();
        this.showToast('Export queued — the file will download automatically when ready');
        this._pollExportJob(job_id);
    },

    _pollExportJob(jobId) {
        this._showExportIndicator();
        const intervalId = setInterval(async () => {
            try {
                const res = await fetch(`/api/jobs/${jobId}`);
                if (!res.ok) return;
                const job = await res.json();
                if (job.result_ready) {
                    clearInterval(intervalId);
                    this._activeExportJobs.delete(jobId);
                    this._onExportDone(jobId);
                } else if (job.status === 'failed') {
                    clearInterval(intervalId);
                    this._activeExportJobs.delete(jobId);
                    this._maybeHideExportIndicator();
                    this.showErrorToast(job.error || 'Export failed');
                }
            } catch (_) { /* non-fatal */ }
        }, 5000);
        this._activeExportJobs.set(jobId, intervalId);
    },

    _onExportDone(jobId) {
        const a = document.createElement('a');
        a.href = `/api/jobs/${jobId}/download`;
        a.click();
        this._maybeHideExportIndicator();
        this.showToast('Export downloaded');
    },

    _showExportIndicator() {
        this.elements.exportProgressIndicator.style.display = '';
    },

    _maybeHideExportIndicator() {
        if (this._activeExportJobs.size === 0) {
            this.elements.exportProgressIndicator.style.display = 'none';
            this.elements.exportProgressIndicator.classList.remove('pinned');
        }
    },

});
