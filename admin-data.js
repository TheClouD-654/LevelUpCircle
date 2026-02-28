const rowsEl = document.querySelector('#rows');
const refreshBtn = document.querySelector('#refresh-btn');
const clearBtn = document.querySelector('#clear-btn');
const statusEl = document.querySelector('#status');

const submissionsKey = 'levelup_buyer_submissions';

const formatDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
};

const renderRows = (entries) => {
  if (!rowsEl) return;

  if (!entries.length) {
    rowsEl.innerHTML = '<tr><td colspan="7">No buyer data found in this browser yet.</td></tr>';
    return;
  }

  const labelStatus = (value) => {
    const status = String(value || 'pending').toLowerCase();
    if (status === 'successful') return 'successful';
    if (status === 'cancelled' || status === 'canceled') return 'cancelled';
    return 'pending';
  };

  rowsEl.innerHTML = entries.map((entry) => `
    <tr>
      <td>${formatDate(entry.createdAt)}</td>
      <td>${entry.name || '-'}</td>
      <td>${entry.email || '-'}</td>
      <td>${entry.phone || '-'}</td>
      <td>${entry.product || '-'}</td>
      <td>${entry.currency || ''} ${entry.amount ?? '-'}</td>
      <td>${labelStatus(entry.paymentStatus)}</td>
    </tr>
  `).join('');
};

const loadLocalRows = () => {
  const entries = JSON.parse(localStorage.getItem(submissionsKey) || '[]');
  renderRows(entries);
};

const loadRows = async () => {
  try {
    const response = await fetch('/api/submissions/list');
    const payload = await response.json().catch(() => ({}));

    if (response.ok && payload.ok && Array.isArray(payload.entries)) {
      renderRows(payload.entries);
      statusEl.textContent = `Loaded ${payload.entries.length} server record(s).`;
      return;
    }

    loadLocalRows();
    statusEl.textContent = 'Server data unavailable. Showing local browser data.';
  } catch (error) {
    loadLocalRows();
    statusEl.textContent = 'Server data unavailable. Showing local browser data.';
  }
};

if (rowsEl && refreshBtn && clearBtn && statusEl) {
  loadRows();

  refreshBtn.addEventListener('click', () => {
    loadRows();
  });

  clearBtn.addEventListener('click', () => {
    localStorage.removeItem(submissionsKey);
    localStorage.removeItem('levelup_buyer_info');
    loadRows();
    statusEl.textContent = 'Local data cleared.';
  });
}
