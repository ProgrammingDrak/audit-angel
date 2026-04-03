// =====================================================
// API Client — wraps all server calls
// =====================================================
var API = {
  async getInvestigations() {
    const r = await fetch('/api/investigations');
    return r.json();
  },
  async getInvestigation(id) {
    const r = await fetch('/api/investigations/' + id);
    return r.json();
  },
  async createInvestigation(name) {
    const r = await fetch('/api/investigations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    return r.json();
  },
  async updateInvestigation(id, fields) {
    const r = await fetch('/api/investigations/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    return r.json();
  },
  async deleteInvestigation(id) {
    const r = await fetch('/api/investigations/' + id, { method: 'DELETE' });
    return r.json();
  },
  async completeInvestigation(id) {
    const r = await fetch('/api/investigations/' + id + '/complete', { method: 'POST' });
    return r.json();
  },
  async reopenInvestigation(id) {
    const r = await fetch('/api/investigations/' + id + '/reopen', { method: 'POST' });
    return r.json();
  },
  async addPin(invId, pin) {
    const r = await fetch('/api/investigations/' + invId + '/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pin) });
    return r.json();
  },
  async updatePin(pinId, fields) {
    const r = await fetch('/api/pins/' + pinId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    return r.json();
  },
  async deletePin(pinId) {
    const r = await fetch('/api/pins/' + pinId, { method: 'DELETE' });
    return r.json();
  },
  async movePin(pinId, targetInvId) {
    const r = await fetch('/api/pins/' + pinId + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_investigation_id: targetInvId }) });
    return r.json();
  },
  async copyPin(pinId, targetInvId) {
    const r = await fetch('/api/pins/' + pinId + '/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_investigation_id: targetInvId }) });
    return r.json();
  },
  async reorderPins(invId, pinIds) {
    const r = await fetch('/api/investigations/' + invId + '/reorder', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin_ids: pinIds }) });
    return r.json();
  },
  async addImages(pinId, images) {
    const r = await fetch('/api/pins/' + pinId + '/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(images) });
    return r.json();
  },
  async updateImage(imageId, fields) {
    const r = await fetch('/api/images/' + imageId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
    return r.json();
  },
  async deleteImage(imageId) {
    const r = await fetch('/api/images/' + imageId, { method: 'DELETE' });
    return r.json();
  },
  async exportJSON() {
    const r = await fetch('/api/export/json');
    return r.json();
  },
  async importJSON(data) {
    const r = await fetch('/api/import/json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return r.json();
  },
  async importLocalStorage(data) {
    const r = await fetch('/api/import/localstorage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return r.json();
  }
};
