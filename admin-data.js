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

const loadRows = () => {
  const entries = JSON.parse(localStorage.getItem(submissionsKey) || '[]');
  if (!rowsEl) return;

  if (!entries.length) {
    rowsEl.innerHTML = '<tr><td colspan="6">No buyer data found in this browser yet.</td></tr>';
    return;
  }

  rowsEl.innerHTML = entries.map((entry) => `
    <tr>
      <td>${formatDate(entry.createdAt)}</td>
      <td>${entry.name || '-'}</td>
      <td>${entry.email || '-'}</td>
      <td>${entry.phone || '-'}</td>
      <td>${entry.product || '-'}</td>
      <td>${entry.currency || ''} ${entry.amount ?? '-'}</td>
    </tr>
  `).join('');
};

if (rowsEl && refreshBtn && clearBtn && statusEl) {
  loadRows();

  refreshBtn.addEventListener('click', () => {
    loadRows();
    statusEl.textContent = 'Data refreshed.';
  });

  clearBtn.addEventListener('click', () => {
    localStorage.removeItem(submissionsKey);
    localStorage.removeItem('levelup_buyer_info');
    loadRows();
    statusEl.textContent = 'Local data cleared.';
  });
}
