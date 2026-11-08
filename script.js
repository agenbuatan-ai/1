let daftarPasien = [];
let editingIndex = -1;
let currentMonitoringId = null;

const apiPendingRequests = new Map();
let gasBridgeReady = false;
let gasBridgeReadyResolvers = [];
let gasBridgePingTimer = null;

function getGasBridgeFrame() {
    return document.getElementById('googleSheetsBridge');
}

function resolveBridgeReady() {
    gasBridgeReady = true;
    gasBridgeReadyResolvers.splice(0).forEach(resolve => resolve());
}

function handleGasBridgeMessage(event) {
    const frame = getGasBridgeFrame();
    if (!frame || event.source !== frame.contentWindow) return;

    const message = event.data || {};

    if (message.type === 'MONITORING_GS_READY') {
        resolveBridgeReady();
        return;
    }

    if (message.type !== 'MONITORING_GS_RESPONSE') return;

    const pending = apiPendingRequests.get(message.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    apiPendingRequests.delete(message.requestId);

    if (message.success) pending.resolve(message.result);
    else pending.reject(new Error(message.error || 'Kesalahan Apps Script.'));
}

window.addEventListener('message', handleGasBridgeMessage);

function waitForGasBridge(timeoutMs = 25000) {
    const frame = getGasBridgeFrame();
    if (!frame) {
        return Promise.reject(new Error(
            'Iframe #googleSheetsBridge tidak ditemukan. Tambahkan iframe bridge pada index.html.'
        ));
    }
    if (gasBridgeReady) return Promise.resolve();

    return new Promise((resolve, reject) => {
        let settled = false;
        let pingTimer = null;
        const onReady = () => finish();

        const finish = (error) => {
            if (settled) return;
            settled = true;
            if (pingTimer) clearInterval(pingTimer);
            clearTimeout(timeoutTimer);
            gasBridgeReadyResolvers = gasBridgeReadyResolvers.filter(fn => fn !== onReady);
            if (error) reject(error);
            else resolve();
        };

        gasBridgeReadyResolvers.push(onReady);

        const ping = () => {
            try {
                if (frame.contentWindow) {
                    frame.contentWindow.postMessage({ type: 'MONITORING_GS_PING' }, '*');
                }
            } catch (error) {
                console.warn('Ping bridge gagal:', error);
            }
        };

        ping();
        pingTimer = setInterval(ping, 600);

        const timeoutTimer = setTimeout(() => {
            finish(new Error(
                'Bridge Apps Script tidak merespons. Periksa URL iframe /exec?mode=bridge, izin login Google, dan deployment Web App.'
            ));
        }, timeoutMs);
    });
}

async function callGoogleSheets(action, payload = {}) {
    await waitForGasBridge();

    const frame = getGasBridgeFrame();
    if (!frame || !frame.contentWindow) {
        throw new Error('Frame Google Apps Script tidak tersedia.');
    }

    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            apiPendingRequests.delete(requestId);
            reject(new Error('Permintaan ke Google Sheets melewati batas waktu. Coba lagi.'));
        }, 35000);

        apiPendingRequests.set(requestId, { resolve, reject, timeout });

        frame.contentWindow.postMessage({
            type: 'MONITORING_GS_REQUEST',
            requestId,
            action,
            payload
        }, '*');
    });
}

const INDIKATOR_TETAP = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

const VALIDASI_MAP = {
    'OK 3B': 'Ns. Evaristo Menezes, S.Kep',
    'OK 5D': 'Ns. Etti Manurung, S.Kep',
    'OK 4C': 'Ns. Kholisotus Solihah, S.Kep'
};

// ==========================================
// FUNGSI FORM (TAMBAH / EDIT / HAPUS)
// ==========================================
function tambahPasien() {
    const nama = document.getElementById('inpNama').value.trim();
    const rm = document.getElementById('inpRM').value.trim();
    const diagnosa = document.getElementById('inpDiagnosa').value.trim();
    const tindakan = document.getElementById('inpTindakan').value.trim();

    if (!nama || !rm || !diagnosa || !tindakan) {
        alert('⚠️ Lengkapi semua data pasien terlebih dahulu!');
        return;
    }

    const data = { nama, rm, diagnosa, tindakan };

    if (editingIndex === -1) {
        daftarPasien.push(data);
    } else {
        daftarPasien[editingIndex] = data;
        batalEdit();
    }

    resetFormPasien();
    renderDaftarPasien();
    document.getElementById('inpNama').focus();
}

function editPasien(index) {
    const p = daftarPasien[index];
    document.getElementById('inpNama').value = p.nama;
    document.getElementById('inpRM').value = p.rm;
    document.getElementById('inpDiagnosa').value = p.diagnosa;
    document.getElementById('inpTindakan').value = p.tindakan;

    editingIndex = index;
    document.getElementById('btnTambahPasien').innerText = '💾 Update Pasien';
    document.getElementById('btnBatalEdit').style.display = 'inline-block';
    document.getElementById('inpNama').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function batalEdit() {
    editingIndex = -1;
    resetFormPasien();
    document.getElementById('btnTambahPasien').innerText = '➕ Tambah Pasien';
    document.getElementById('btnBatalEdit').style.display = 'none';
}

function resetFormPasien() {
    document.getElementById('inpNama').value = '';
    document.getElementById('inpRM').value = '';
    document.getElementById('inpDiagnosa').value = '';
    document.getElementById('inpTindakan').value = '';
}

function hapusPasien(index) {
    if (confirm('Hapus data pasien "' + daftarPasien[index].nama + '"?')) {
        daftarPasien.splice(index, 1);
        if (editingIndex === index) batalEdit();
        else if (editingIndex > index) editingIndex--;
        renderDaftarPasien();
    }
}

function renderDaftarPasien() {
    const tbody = document.getElementById('bodyDaftarPasien');
    document.getElementById('jumlahPasien').innerText = daftarPasien.length;

    if (daftarPasien.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Belum ada pasien ditambahkan</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    daftarPasien.forEach(function(pasien, index) {
        const tr = document.createElement('tr');

        function addCell(value, styleText) {
            const td = document.createElement('td');
            td.textContent = value == null ? '' : String(value);
            if (styleText) td.style.cssText = styleText;
            tr.appendChild(td);
            return td;
        }

        addCell(index + 1, 'text-align:center;');
        addCell(pasien.nama);
        addCell(pasien.rm, 'text-align:center;');
        addCell(pasien.diagnosa);
        addCell(pasien.tindakan);

        const actionCell = addCell('', 'text-align:center;white-space:nowrap;');
        const editButton = document.createElement('button');
        editButton.className = 'btn-edit';
        editButton.type = 'button';
        editButton.textContent = '✏️ Edit';
        editButton.addEventListener('click', () => editPasien(index));

        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn-hapus';
        deleteButton.type = 'button';
        deleteButton.textContent = '🗑️ Hapus';
        deleteButton.addEventListener('click', () => hapusPasien(index));

        actionCell.append(editButton, deleteButton);
        tbody.appendChild(tr);
    });
}

// ==========================================
// SIMPAN DAN MUAT MELALUI GOOGLE SPREADSHEET
// ==========================================
async function simpanData() {
    const tanggal = document.getElementById('inpTanggal').value;
    const pengumpul = document.getElementById('inpPengumpul').value.trim();

    if (!tanggal) { alert('⚠️ Isi Tanggal / Hari terlebih dahulu!'); return; }
    if (!pengumpul) { alert('⚠️ Isi Nama Pengumpul Data terlebih dahulu!'); return; }
    if (daftarPasien.length === 0) { alert('⚠️ Tambahkan minimal 1 data pasien!'); return; }

    const data = {
        id: currentMonitoringId,
        tanggal: tanggal,
        ruangan: document.getElementById('inpRuangan').value,
        pengumpul: pengumpul,
        daftarPasien: daftarPasien
    };

    const saveButton = document.querySelector('.form-actions .btn-warning');
    const originalText = saveButton ? saveButton.innerText : '';
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerText = '⏳ Menyimpan...';
    }

    try {
        const result = await callGoogleSheets('saveMonitoring', data);
        currentMonitoringId = result.id;
        alert('✅ Data berhasil disimpan ke Google Spreadsheet!\nJumlah pasien: ' + result.jumlahPasien);
    } catch (error) {
        console.error('Gagal menyimpan ke Google Sheets:', error);
        alert('❌ Gagal menyimpan data.\n' + error.message);
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.innerText = originalText || '💾 Simpan';
        }
    }
}

async function loadData() {
    renderDaftarPasien();

    try {
        const data = await callGoogleSheets('getLatestMonitoring', {});

        if (data) {
            currentMonitoringId = data.id || null;
            document.getElementById('inpTanggal').value = data.tanggal || '';
            document.getElementById('inpRuangan').value = data.ruangan || 'OK 5D';
            document.getElementById('inpPengumpul').value = data.pengumpul || '';
            daftarPasien = Array.isArray(data.daftarPasien) ? data.daftarPasien : [];
        } else {
            currentMonitoringId = null;
            daftarPasien = [];
        }

        renderDaftarPasien();
    } catch (error) {
        console.error('Gagal memuat data Google Sheets:', error);
        alert(
            '⚠️ Belum dapat terhubung ke Google Spreadsheet.\n\n' +
            error.message +
            '\n\nPastikan URL Web App sudah dipasang pada iframe di index.html, deployment sudah diperbarui, dan Anda sudah menguji akses melalui URL /exec.'
        );
    }
}

function mulaiDataBaru() {
    const adaIsian = document.getElementById('inpTanggal').value ||
        document.getElementById('inpPengumpul').value ||
        daftarPasien.length > 0;

    if (adaIsian && !confirm('Mulai monitoring baru? Perubahan yang belum disimpan akan hilang.')) {
        return;
    }

    currentMonitoringId = null;
    daftarPasien = [];
    editingIndex = -1;

    document.getElementById('inpTanggal').value = '';
    document.getElementById('inpRuangan').value = 'OK 5D';
    document.getElementById('inpPengumpul').value = '';

    resetFormPasien();
    document.getElementById('btnTambahPasien').innerText = '➕ Tambah Pasien';
    document.getElementById('btnBatalEdit').style.display = 'none';
    renderDaftarPasien();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// FUNGSI BANTU MENCETAK TABEL (MINIMAL 10 BARIS)
// ==========================================
function formatTanggal(tglString) {
    if(!tglString) return '-';
    const dateObj = new Date(tglString + 'T00:00:00');
    return dateObj.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderTabel1() {
    const tbody = document.getElementById('tableBody1');
    tbody.innerHTML = '';
    let total = 0;
    const totalRows = Math.max(10, daftarPasien.length);

    for (let i = 0; i < totalRows; i++) {
        const tr = document.createElement('tr');
        const p = daftarPasien[i];
        
        if (p) {
            let rowHTML = `
                <td>${i + 1}</td>
                <td class="text-left">${p.nama}</td>
                <td>${p.rm}</td>
                <td class="text-left">${p.diagnosa}</td>
                <td class="text-left">${p.tindakan}</td>
            `;
            INDIKATOR_TETAP.forEach(val => { rowHTML += `<td>${val}</td>`; });
            rowHTML += `<td></td>`;
            tr.innerHTML = rowHTML;
            total += 11;
        } else {
            tr.innerHTML = `<td>${i + 1}</td><td></td><td></td><td></td><td></td>` + '<td></td>'.repeat(11) + '<td></td>';
        }
        tbody.appendChild(tr);
    }
    return total;
}

function renderTabelGenerik(tbodyId, jumlahIndikator) {
    if (tbodyId === 'tableBody4') {
        return renderTabel4();
    }
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    let total = 0;
    const totalRows = Math.max(10, daftarPasien.length);

    for (let i = 0; i < totalRows; i++) {
        const tr = document.createElement('tr');
        const p = daftarPasien[i];
        
        if (p) {
            let rowHTML = `
                <td>${i + 1}</td>
                <td class="text-left">${p.nama}</td>
                <td>${p.rm}</td>
                <td class="text-left">${p.diagnosa}</td>
                <td class="text-left">${p.tindakan}</td>
            `;
            for(let j=0; j<jumlahIndikator; j++) rowHTML += `<td>1</td>`;
            rowHTML += `<td></td>`;
            tr.innerHTML = rowHTML;
            total += jumlahIndikator;
        } else {
            tr.innerHTML = `<td>${i + 1}</td><td></td><td></td><td></td><td></td>` + '<td></td>'.repeat(jumlahIndikator) + '<td></td>';
        }
        tbody.appendChild(tr);
    }
    return total;
}

function renderTabel4() {
    const tbody = document.getElementById('tableBody4');
    tbody.innerHTML = '';
    let total = 0;
    const totalRows = Math.max(10, daftarPasien.length);
    const tgl = formatTanggal(document.getElementById('inpTanggal').value);

    for (let i = 0; i < totalRows; i++) {
        const tr = document.createElement('tr');
        const p = daftarPasien[i];
        
        if (p) {
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${tgl}</td>
                <td class="text-left">${p.nama}</td>
                <td>${p.rm}</td>
                <td class="text-left">${p.diagnosa}</td>
                <td>1</td>
                <td>1</td>
                <td>1</td>
                <td></td>
            `;
            total += 3;
        } else {
            tr.innerHTML = `<td>${i + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>`;
        }
        tbody.appendChild(tr);
    }
    return total;
}

// ==========================================
// TAMPILKAN OUTPUT (5 LEMBAR)
// ==========================================
function tampilkanOutput() {
    const tanggal = document.getElementById('inpTanggal').value;
    const ruangan = document.getElementById('inpRuangan').value;
    const pengumpul = document.getElementById('inpPengumpul').value.trim();

    if (!tanggal) { alert('⚠️ Isi Tanggal / Hari terlebih dahulu!'); return; }
    if (daftarPasien.length === 0) { alert('⚠️ Tambahkan minimal 1 data pasien!'); return; }
    if (!pengumpul) { alert('⚠️ Isi Nama Pengumpul Data terlebih dahulu!'); return; }

    const tglFormat = formatTanggal(tanggal);
    const namaValidasi = VALIDASI_MAP[ruangan] || '-';

    for(let i=1; i<=5; i++) {
        document.getElementById(`outRuangan${i}`).innerText = ruangan;
        document.getElementById(`outTanggal${i}`).innerText = tglFormat;
        document.getElementById(`outPengumpul${i}`).innerText = pengumpul;
        document.getElementById(`outValidasi${i}`).innerText = namaValidasi;
    }

    let total1 = renderTabel1();
    document.getElementById('totalN1').innerText = total1;
    document.getElementById('persentase1').innerText = ((total1 / (daftarPasien.length * 11)) * 100).toFixed(2) + '%';

    let total2 = renderTabelGenerik('tableBody2', 6);
    document.getElementById('totalN2').innerText = total2;
    document.getElementById('persentase2').innerText = ((total2 / (daftarPasien.length * 6)) * 100).toFixed(2) + '%';

    let total3 = renderTabelGenerik('tableBody3', 5);
    document.getElementById('totalN3').innerText = total3;
    document.getElementById('persentase3').innerText = ((total3 / (daftarPasien.length * 5)) * 100).toFixed(2) + '%';

    let total4 = renderTabel4();
    document.getElementById('totalN4').innerText = total4;
    document.getElementById('persentase4').innerText = ((total4 / (daftarPasien.length * 3)) * 100).toFixed(2) + '%';

    let total5 = renderTabelGenerik('tableBody5', 9);
    document.getElementById('totalN5').innerText = total5;
    document.getElementById('persentase5').innerText = ((total5 / (daftarPasien.length * 9)) * 100).toFixed(2) + '%';

    document.getElementById('formView').classList.add('hidden');
    document.getElementById('outputView').classList.remove('hidden');
    window.scrollTo(0, 0);
}

function kembaliKeForm() {
    document.getElementById('outputView').classList.add('hidden');
    document.getElementById('formView').classList.remove('hidden');
    window.scrollTo(0, 0);
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', loadData, { once: true });
} else {
    loadData();
}
