// y-front — shared frontend utilities

/**
 * Perform a JSON fetch with CSRF-safe method.
 * @param {string} url
 * @param {object} options - fetch options (method, body, etc.)
 * @returns {Promise<Response>}
 */
export const apiFetch = (url, options = {}) =>
  fetch(url, {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

/**
 * Format bytes as a human-readable string.
 * @param {number|null} bytes
 * @returns {string}
 */
export const formatBytes = (bytes) => {
  if (bytes == null || isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
};

/**
 * Format seconds as mm:ss or hh:mm:ss.
 * @param {number|null} sec
 * @returns {string}
 */
export const formatEta = (sec) => {
  if (sec == null || isNaN(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};
