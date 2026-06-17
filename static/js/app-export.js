// -----------------------------------------------------------------------
// Export dialog
// -----------------------------------------------------------------------

Object.assign(GrooveDropper, {

    _exportPollInterval: null,

    async showExportDialog() {
        // Guard: refuse if any export_* job is already queued or running
        try {
            const res = await fetch('/api/jobs');
            if (res.ok) {
                const jobs   = await res.json();
                const active = jobs.filter(j =>
                    j.job_type.startsWith('export_') &&
                    (j.status === 'queued' || j.status === 'running')
                );
                if (active.length > 0) {
                    this.showToast('An export is already in progress');
                    return;
                }
            }
        } catch (_) { /* non-fatal */ }

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
        this.showToast("Export queued — you'll be notified when the download is ready");
        this._pollExportJob(job_id);
    },

    _pollExportJob(jobId) {
        if (this._exportPollInterval) {
            clearInterval(this._exportPollInterval);
        }
        this._exportPollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/jobs/${jobId}`);
                if (!res.ok) return;
                const job = await res.json();
                if (job.result_ready) {
                    clearInterval(this._exportPollInterval);
                    this._exportPollInterval = null;
                    this._showExportReadyToast(jobId);
                } else if (job.status === 'failed') {
                    clearInterval(this._exportPollInterval);
                    this._exportPollInterval = null;
                    this.showErrorToast(job.error || 'Export failed');
                }
            } catch (_) { /* non-fatal */ }
        }, 5000);
    },

    _showExportReadyToast(jobId) {
        const toast = this.elements.toast;
        toast.innerHTML = '';
        toast.appendChild(document.createTextNode('Export ready — '));
        const link = document.createElement('a');
        link.href        = `/api/jobs/${jobId}/download`;
        link.textContent = 'Download';
        link.style.cssText = 'color:inherit;font-weight:bold;text-decoration:underline;cursor:pointer;';
        link.addEventListener('click', () => {
            setTimeout(() => { toast.className = ''; toast.innerHTML = ''; }, 500);
        });
        toast.appendChild(link);
        toast.className = 'show';
        // Dismissed by any keypress
        const dismiss = () => {
            toast.className  = '';
            toast.innerHTML  = '';
            document.removeEventListener('keydown', dismiss);
        };
        document.addEventListener('keydown', dismiss);
    },

});
