// ==================== 1. CONFIGURATION & STATE ====================
const firebaseConfig = {
    apiKey: "AIzaSyDBdakB1PQU0cyO8q1MYficltzoi-kKBdQ",
    authDomain: "habit-tracker-17e23.firebaseapp.com",
    projectId: "habit-tracker-17e23",
    storageBucket: "habit-tracker-17e23.firebasestorage.app",
    messagingSenderId: "648562953307",
    appId: "1:648562953307:web:a4e89af1c95db1b5fdc37e",
    measurementId: "G-CNGFF72KJC"
};

// Firebase Services initialisieren
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();
const messaging = firebase.messaging(); // NEU hinzufügen

// App State Variables
const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const openWeeks = new Set();
let currentUser = null;
let userHabits = [];
let userLogs = {};
let activeTab = 'tracker';
let pendingDeleteData = { habitId: null, habitName: '', year: null, week: null };
let reactivateHabitData = null;

let userSettings = {
    xpPerLevel: 100,
    targetWeekXp: 215,
    pushTime: "20:00",  // NEU
    pushEnabled: false  // NEU
};

// ==================== 2. AUTHENTICATION & SETTINGS ====================
document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById('startDate');
    if (startDateInput) {
        startDateInput.value = new Date().toISOString().split('T')[0];
    }
});

function loginWithGoogle() {
    auth.signInWithPopup(googleProvider).catch(err => alert("Login fehlgeschlagen: " + err.message));
}

function logout() {
    auth.signOut();
}

auth.onAuthStateChanged(async (user) => {
    const loginBtn = document.getElementById('loginBtn');
    const userProfile = document.getElementById('userProfile');

    if (user) {
        currentUser = user;
        if (loginBtn) loginBtn.classList.add('hidden');
        if (userProfile) {
            userProfile.classList.remove('hidden');
            const elName = document.getElementById('userName');
            const elAvatar = document.getElementById('userAvatar');
            if (elName) elName.innerText = user.displayName ? user.displayName.split(' ')[0] : 'User';
            if (elAvatar) elAvatar.src = user.photoURL || '';
        }
        await loadUserSettings();
        attachRealtimeListeners();
    } else {
        currentUser = null;
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (userProfile) userProfile.classList.add('hidden');
        userHabits = [];
        userLogs = {};
        refreshCurrentTab();
    }
});

async function loadUserSettings() {
    if (!currentUser) return;
    try {
        const settingsDoc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('gamification').get();
        if (settingsDoc.exists) {
            userSettings = { ...userSettings, ...settingsDoc.data() };
        }
        document.getElementById('settingXpPerLevel').value = userSettings.xpPerLevel;
        document.getElementById('settingTargetWeekXp').value = userSettings.targetWeekXp;
        
        // NEU: Uhrzeit ins Feld laden
        const pushTimeEl = document.getElementById('settingPushTime');
        if (pushTimeEl) pushTimeEl.value = userSettings.pushTime || "20:00";
    } catch (err) {
        console.error("Fehler beim Laden:", err);
    }
}

async function saveGamificationSettings() {
    if (!currentUser) return alert("Bitte melde dich erst an!");

    // 1. HTML-Elemente sicher suchen
    const elXp = document.getElementById('settingXpPerLevel');
    const elWeek = document.getElementById('settingTargetWeekXp');
    const elTime = document.getElementById('settingPushTime');

    // 2. Werte nur auslesen, wenn das Feld im HTML auch wirklich existiert
    if (elXp) userSettings.xpPerLevel = parseFloat(elXp.value) || 100;
    if (elWeek) userSettings.targetWeekXp = parseFloat(elWeek.value) || 215;
    if (elTime) userSettings.pushTime = elTime.value;

    try {
        await db.collection('users').doc(currentUser.uid).collection('settings').doc('gamification').set(userSettings, { merge: true });
        console.log("Einstellungen erfolgreich gespeichert!");
        refreshCurrentTab();
    } catch (err) {
        alert("Fehler beim Speichern: " + err.message);
    }
}

// ==================== 3. REALTIME CLOUD LISTENERS ====================
function attachRealtimeListeners() {
    if (!currentUser) return;

    db.collection('users').doc(currentUser.uid).collection('habits')
      .onSnapshot(snapshot => {
          userHabits = [];
          snapshot.forEach(doc => userHabits.push({ id: doc.id, ...doc.data() }));
          refreshCurrentTab();
      });

    db.collection('users').doc(currentUser.uid).collection('logs')
      .onSnapshot(snapshot => {
          userLogs = {};
          snapshot.forEach(doc => userLogs[doc.id] = { id: doc.id, ...doc.data() });
          refreshCurrentTab();
      });
}

function refreshCurrentTab() {
    if (activeTab === 'tracker') renderWeeks();
    else if (activeTab === 'habits') renderHabitsManage();
    else if (activeTab === 'stats') renderStats();
    else if (activeTab === 'archive') renderArchiveWeeks();
}

// ==================== 4. NAVIGATION ====================
function switchTab(tab) {
    activeTab = tab;

    document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
        btn.className = "nav-tab-btn flex items-center gap-2 px-4 sm:px-5 lg:px-6 py-2.5 lg:py-3 rounded-full text-xs sm:text-sm lg:text-base font-semibold transition-all duration-200 text-gray-400 hover:text-white";
    });

    const targetView = document.getElementById(`view-${tab}`);
    if (targetView) targetView.classList.remove('hidden');

    const activeBtn = document.getElementById(`nav-btn-${tab}`);
    if (activeBtn) {
        activeBtn.className = "nav-tab-btn flex items-center gap-2 px-4 sm:px-5 lg:px-6 py-2.5 lg:py-3 rounded-full text-xs sm:text-sm lg:text-base font-semibold transition-all duration-200 bg-gray-700 text-white shadow-md";
    }

    refreshCurrentTab();
}

// ==================== 5. HABIT MANAGEMENT ====================
document.getElementById('addHabitForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("Bitte melde dich erst an!");

    let duration = 0;
    if (document.getElementById('durationType').value === 'custom') {
        duration = parseInt(document.getElementById('durationWeeks').value) || 1;
    }

    const habitData = {
        name: document.getElementById('name').value,
        goal_days_per_week: parseInt(document.getElementById('goal').value),
        xp_per_habit: parseFloat(document.getElementById('xp').value.replace(',', '.')),
        color: document.getElementById('color').value,
        notes: document.getElementById('notes').value,
        start_date: document.getElementById('startDate').value,
        duration_weeks: duration,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection('users').doc(currentUser.uid).collection('habits').add(habitData);
        closeModal();
        document.getElementById('addHabitForm').reset();
    } catch (err) {
        alert("Fehler beim Erstellen: " + err.message);
    }
});

function openEditModal(habit) {
    document.getElementById('editHabitId').value = habit.id;
    document.getElementById('editName').value = habit.name;
    document.getElementById('editGoal').value = habit.goal_days_per_week;
    document.getElementById('editXp').value = habit.xp_per_habit;
    document.getElementById('editColor').value = habit.color;
    document.getElementById('editNotes').value = habit.notes || '';
    document.getElementById('editStartDate').value = habit.start_date;

    if (habit.duration_weeks > 0) {
        document.getElementById('editDurationType').value = 'custom';
        document.getElementById('editDurationWeeks').value = habit.duration_weeks;
        document.getElementById('editDurationInputContainer').classList.remove('hidden');
    } else {
        document.getElementById('editDurationType').value = '0';
        document.getElementById('editDurationInputContainer').classList.add('hidden');
    }

    document.getElementById('editHabitModal').classList.remove('hidden');
}

function closeEditModal() { document.getElementById('editHabitModal').classList.add('hidden'); }

document.getElementById('editHabitForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const habitId = document.getElementById('editHabitId').value;
    const newGoal = parseInt(document.getElementById('editGoal').value);
    const newXp = parseFloat(document.getElementById('editXp').value.replace(',', '.'));
    
    let duration = 0;
    if (document.getElementById('editDurationType').value === 'custom') {
        duration = parseInt(document.getElementById('editDurationWeeks').value) || 1;
    }

    const oldHabit = userHabits.find(h => h.id === habitId);
    const oldGoal = oldHabit ? oldHabit.goal_days_per_week : newGoal;
    const oldXp = oldHabit ? oldHabit.xp_per_habit : newXp;

    // Wenn sich Ziel oder XP geändert haben, sichern wir die alten Werte für vergangene Wochen
    if (oldHabit && (newGoal !== oldGoal || newXp !== oldXp)) {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentWeek = getISOWeek(today);
        const currentMon = getMondayOfISOWeek(currentYear, currentWeek);

        const habitStart = new Date(oldHabit.start_date);
        const habitStartMon = getMondayOfISOWeek(habitStart.getFullYear(), getISOWeek(habitStart));

        const batch = db.batch();
        let hasBatchUpdates = false;

        let checkDate = new Date(habitStartMon);
        while (checkDate < currentMon) {
            const y = checkDate.getFullYear();
            const w = getISOWeek(checkDate);
            const logKey = `${y}_${w}_${habitId}`;
            const existingLog = userLogs[logKey] || {};

            let updatesNeeded = {};
            if (newGoal !== oldGoal && existingLog.goal_days_per_week === undefined) {
                updatesNeeded.goal_days_per_week = oldGoal;
            }
            if (newXp !== oldXp && existingLog.xp_per_habit === undefined) {
                updatesNeeded.xp_per_habit = oldXp;
            }

            if (Object.keys(updatesNeeded).length > 0) {
                const logRef = db.collection('users').doc(currentUser.uid).collection('logs').doc(logKey);
                batch.set(logRef, { 
                    ...updatesNeeded,
                    habitId: habitId,
                    year: y,
                    week: w
                }, { merge: true });
                hasBatchUpdates = true;
            }

            checkDate.setDate(checkDate.getDate() + 7);
        }

        if (hasBatchUpdates) {
            await batch.commit();
        }
    }

    // Habit mit den neuen Werten für aktuelle und zukünftige Wochen aktualisieren
    const updatedData = {
        name: document.getElementById('editName').value,
        goal_days_per_week: newGoal,
        xp_per_habit: newXp,
        color: document.getElementById('editColor').value,
        notes: document.getElementById('editNotes').value,
        start_date: document.getElementById('editStartDate').value,
        duration_weeks: duration
    };

    try {
        await db.collection('users').doc(currentUser.uid).collection('habits').doc(habitId).update(updatedData);
        closeEditModal();
    } catch (err) {
        alert("Fehler beim Speichern: " + err.message);
    }
});

function openReactivateModal(habit) {
    reactivateHabitData = habit;
    document.getElementById('reactivateHabitId').value = habit.id;
    document.getElementById('reactivateHabitName').innerText = habit.name;
    document.getElementById('reactivateStartDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('reactivateXp').value = habit.xp_per_habit;
    document.getElementById('reactivateDurationType').value = '0';
    document.getElementById('reactivateDurationInputContainer').classList.add('hidden');
    document.getElementById('reactivateHabitModal').classList.remove('hidden');
}

function closeReactivateModal() { document.getElementById('reactivateHabitModal').classList.add('hidden'); }

document.getElementById('reactivateHabitForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser || !reactivateHabitData) return;

    const habitId = reactivateHabitData.id;
    let duration = 0;
    if (document.getElementById('reactivateDurationType').value === 'custom') {
        duration = parseInt(document.getElementById('reactivateDurationWeeks').value) || 1;
    }

    const updateData = {
        start_date: document.getElementById('reactivateStartDate').value,
        duration_weeks: duration,
        xp_per_habit: parseFloat(document.getElementById('reactivateXp').value.replace(',', '.'))
    };

    try {
        await db.collection('users').doc(currentUser.uid).collection('habits').doc(habitId).update(updateData);
        closeReactivateModal();
    } catch (err) {
        alert("Fehler beim Reaktivieren: " + err.message);
    }
});

function openWeekGoalModal(habitId, habitName, currentGoal, year, week) {
    document.getElementById('wgHabitId').value = habitId;
    document.getElementById('wgHabitName').innerText = habitName;
    document.getElementById('wgGoal').value = currentGoal;
    document.getElementById('wgYear').value = year;
    document.getElementById('wgWeek').value = week;
    document.getElementById('weekGoalModal').classList.remove('hidden');
}

function closeWeekGoalModal() { document.getElementById('weekGoalModal').classList.add('hidden'); }

document.getElementById('weekGoalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const habitId = document.getElementById('wgHabitId').value;
    const year = document.getElementById('wgYear').value;
    const week = document.getElementById('wgWeek').value;
    const newGoal = parseInt(document.getElementById('wgGoal').value);

    const logKey = `${year}_${week}_${habitId}`;
    const logRef = db.collection('users').doc(currentUser.uid).collection('logs').doc(logKey);

    try {
        await logRef.set({ 
            goal_days_per_week: newGoal,
            habitId: habitId,
            year: parseInt(year),
            week: parseInt(week)
        }, { merge: true });
        closeWeekGoalModal();
    } catch (err) {
        alert("Fehler beim Anpassen: " + err.message);
    }
});
// ==================== 6. DELETE HANDLING ====================
function promptDeleteHabit(habitId, habitName, year, week) {
    pendingDeleteData = { habitId, habitName, year, week };
    document.getElementById('deleteHabitName').innerText = habitName;
    document.getElementById('deleteStep1').classList.remove('hidden');
    document.getElementById('deleteStep2').classList.add('hidden');
    document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() { document.getElementById('deleteModal').classList.add('hidden'); }

function backToDeleteStep1() {
    document.getElementById('deleteStep1').classList.remove('hidden');
    document.getElementById('deleteStep2').classList.add('hidden');
}

function goToDeleteStep2() {
    const scope = document.querySelector('input[name="deleteScope"]:checked').value;
    const confirmText = document.getElementById('deleteConfirmText');

    if (scope === 'this_week') {
        confirmText.innerText = `Möchtest du "${pendingDeleteData.habitName}" nur für KW ${pendingDeleteData.week} ausblenden?`;
    } else if (scope === 'future') {
        confirmText.innerText = `Möchtest du "${pendingDeleteData.habitName}" ab KW ${pendingDeleteData.week} beenden?`;
    } else {
        confirmText.innerText = `Bist du sicher, dass du "${pendingDeleteData.habitName}" VOLLSTÄNDIG löschen möchtest?`;
    }

    document.getElementById('deleteStep1').classList.add('hidden');
    document.getElementById('deleteStep2').classList.remove('hidden');
}

async function confirmDeleteHabit() {
    if (!currentUser) return;
    const scope = document.querySelector('input[name="deleteScope"]:checked').value;
    const { habitId, year, week } = pendingDeleteData;

    try {
        if (scope === 'this_week') {
            const logKey = `${year}_${week}_${habitId}`;
            await db.collection('users').doc(currentUser.uid).collection('logs').doc(logKey).set({ 
                is_skipped: true,
                habitId: habitId,
                year: parseInt(year),
                week: parseInt(week)
            }, { merge: true });
        } else if (scope === 'future') {
            const habit = userHabits.find(h => h.id === habitId);
            if (habit) {
                const targetMon = getMondayOfISOWeek(year, week);
                const habitStart = new Date(habit.start_date);
                const weeksDiff = Math.max(0, Math.floor((targetMon - habitStart) / (1000 * 60 * 60 * 24 * 7)));
                if (weeksDiff <= 0) {
                    await db.collection('users').doc(currentUser.uid).collection('habits').doc(habitId).delete();
                } else {
                    await db.collection('users').doc(currentUser.uid).collection('habits').doc(habitId).update({ duration_weeks: weeksDiff });
                }
            }
        } else {
            await db.collection('users').doc(currentUser.uid).collection('habits').doc(habitId).delete();
        }
        closeDeleteModal();
    } catch (err) {
        alert("Fehler beim Löschen: " + err.message);
    }
}
// ==================== 7. TRACKER & CHECK-IN LOGIC ====================
async function toggleDayCloud(habitId, day, isChecked, year, week) {
    if (!currentUser) return;

    const logKey = `${year}_${week}_${habitId}`;
    const logRef = db.collection('users').doc(currentUser.uid).collection('logs').doc(logKey);

    const updateObj = {
        habitId: habitId,
        year: parseInt(year),
        week: parseInt(week)
    };
    updateObj[day] = isChecked;

    await logRef.set(updateObj, { merge: true });
}

function renderWeeks() {
    renderWeeksGeneric('weeksContainer', false);
}

function renderArchiveWeeks() {
    renderWeeksGeneric('archiveContainer', true);
}

function renderWeeksGeneric(containerId, isArchive) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentWeek = getISOWeek(today);

    const weekRange = isArchive ? [-24, -9] : [-8, 4];

    for (let offset = weekRange[1]; offset >= weekRange[0]; offset--) {
        const refDate = new Date();
        refDate.setDate(today.getDate() + (offset * 7));
        const y = refDate.getFullYear();
        const w = getISOWeek(refDate);
        const isCurrent = (y === currentYear && w === currentWeek);
        const weekKey = `${y}-${w}`;
        const isOpen = isCurrent || openWeeks.has(weekKey);
        const isArchived = isWeekArchived(y, w);

        const activeHabits = getActiveHabitsForWeek(y, w);

        const mon = getMondayOfISOWeek(y, w);
        const sun = new Date(mon);
        sun.setDate(sun.getDate() + 6);

        const formatShort = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
        const formatFull = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
        const dateRangeStr = `${formatShort(mon)} - ${formatFull(sun)}`;

        const weekDiv = document.createElement('div');
        weekDiv.className = 'bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-lg mb-6 transition-all';

        const lockBadge = isArchived ? `<span class="text-xs lg:text-sm bg-red-900/40 text-red-300 border border-red-700/50 px-2.5 py-1 rounded-md">🔒 Schreibgeschützt</span>` : '';

        weekDiv.innerHTML = `
            <div onclick="toggleWeekAccordion('${weekKey}')" class="flex items-center justify-between p-4 lg:p-5 bg-gray-800 hover:bg-gray-750 cursor-pointer select-none border-b border-gray-700/60">
                <div class="flex items-center gap-3 lg:gap-4">
                    <span id="arrow-${weekKey}" class="text-xs lg:text-sm text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}">▶</span>
                    <span class="font-bold text-gray-200 text-base lg:text-xl">KW ${w} <span class="text-xs lg:text-sm font-normal text-gray-400 ml-1">(${dateRangeStr})</span></span>
                    <span class="bg-gray-700 text-gray-300 text-xs lg:text-sm px-2.5 py-0.5 rounded-full font-mono font-semibold">${activeHabits.length}</span>
                </div>
                ${lockBadge}
            </div>
            <div id="content-${weekKey}" class="${isOpen ? '' : 'hidden'} p-4 lg:p-6 overflow-x-auto">
                <table class="w-full text-left text-xs lg:text-sm border-collapse">
                    <thead>
                        <tr class="border-b border-gray-700 text-gray-400 uppercase tracking-wider font-semibold">
                            <th class="p-3 lg:p-4">Habit</th>
                            <th class="p-3 lg:p-4 text-center">Mo</th>
                            <th class="p-3 lg:p-4 text-center">Di</th>
                            <th class="p-3 lg:p-4 text-center">Mi</th>
                            <th class="p-3 lg:p-4 text-center">Do</th>
                            <th class="p-3 lg:p-4 text-center">Fr</th>
                            <th class="p-3 lg:p-4 text-center">Sa</th>
                            <th class="p-3 lg:p-4 text-center">So</th>
                            <th class="p-3 lg:p-4 text-center">Fortschritt</th>
                            <th class="p-3 lg:p-4 text-center">XP</th>
                            <th class="p-3 lg:p-4 text-center">Aktion</th>
                        </tr>
                    </thead>
                    <tbody>${renderHabitsForWeekRows(activeHabits, y, w, isArchived)}</tbody>
                </table>
            </div>
        `;
        container.appendChild(weekDiv);
    }
}

function getActiveHabitsForWeek(year, week) {
    const mon = getMondayOfISOWeek(year, week);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);

    return userHabits.filter(h => {
        const hStart = new Date(h.start_date);
        let hEnd = null;
        if (h.duration_weeks > 0) {
            hEnd = new Date(hStart);
            hEnd.setDate(hEnd.getDate() + (h.duration_weeks * 7));
        }

        if (hStart > sun) return false;
        if (hEnd && hEnd < mon) return false;

        const logKey = `${year}_${week}_${h.id}`;
        const log = userLogs[logKey];
        if (log && log.is_skipped) return false;

        return true;
    });
}

function renderHabitsForWeekRows(habits, year, week, isReadOnly) {
    if (habits.length === 0) {
        return `<tr><td colspan="11" class="text-center p-6 text-gray-500 italic text-sm lg:text-base">Keine aktiven Habits in dieser Woche</td></tr>`;
    }

    return habits.map(h => {
        const logKey = `${year}_${week}_${h.id}`;
        const log = userLogs[logKey] || {};
        const effectiveGoal = log.goal_days_per_week || h.goal_days_per_week;
        const effectiveXp = log.xp_per_habit !== undefined ? log.xp_per_habit : h.xp_per_habit;
        const disabledAttr = isReadOnly ? 'disabled cursor-not-allowed opacity-60' : 'cursor-pointer';

        let dayCheckboxes = days.map(d => `
            <td class="p-3 lg:p-4 text-center">
                <input type="checkbox" ${log[d] ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''}
                    onchange="event.stopPropagation(); toggleDayCloud('${h.id}', '${d}', this.checked, ${year}, ${week})"
                    style="accent-color: ${h.color};"
                    class="w-4 h-4 lg:w-5 lg:h-5 rounded ${disabledAttr}">
            </td>
        `).join('');

        const doneCount = days.filter(d => log[d]).length;
        const pct = effectiveGoal > 0 ? Math.round((doneCount / effectiveGoal) * 100) : 0;
        const xp = (doneCount * effectiveXp).toFixed(1);

        // Streak & Bearbeiten-Buttons definieren
        const streak = calculateHabitStreak(h, userLogs);
        const streakBadge = streak > 0 ? `<span class="text-[10px] bg-orange-950/60 text-orange-300 px-1.5 py-0.5 rounded border border-orange-800/50 ml-1">🔥 ${streak}</span>` : '';

        const safeName = h.name.replace(/'/g, "\\'");
        const goalEditBtn = !isReadOnly ? `<button onclick="openWeekGoalModal('${h.id}', '${safeName}', ${effectiveGoal}, ${year}, ${week})" class="text-indigo-400 hover:text-indigo-300 ml-1.5 text-xs lg:text-sm">✏️</button>` : '';

        return `
            <tr class="border-b border-gray-750/50 hover:bg-gray-750/50 transition">
                <td class="p-3 lg:p-4 font-medium text-white">
                    <div class="flex items-center gap-3">
                        <span class="w-3 h-3 lg:w-3.5 lg:h-3.5 rounded-full inline-block shrink-0" style="background-color: ${h.color};"></span>
                        <div>
                            <span class="text-sm lg:text-base font-semibold block text-gray-100">${h.name} ${streakBadge}</span>
                            <span class="text-[11px] lg:text-xs text-gray-400 block mt-0.5">Ziel: ${effectiveGoal} Tage/W. ${goalEditBtn}</span>
                        </div>
                    </div>
                </td>
                ${dayCheckboxes}
                <td class="p-3 lg:p-4 text-center font-bold text-indigo-300 text-sm lg:text-base">${pct}%</td>
                <td class="p-3 lg:p-4 text-center font-bold text-yellow-400 text-sm lg:text-base">+${xp} XP</td>
                <td class="p-3 lg:p-4 text-center">
                    ${isReadOnly ? '🔒' : `<button onclick="promptDeleteHabit('${h.id}', '${safeName}', ${year},${week})" class="text-red-400 hover:text-red-300 p-1.5 text-sm lg:text-base transition">🗑️</button>`}
                </td>
            </tr>
        `;
    }).join('');
}
// ==================== 8. HABITS OVERVIEW TAB ====================
function renderHabitsManage() {
    const activeContainer = document.getElementById('activeHabitsList');
    const expiredContainer = document.getElementById('expiredHabitsList');
    if (!activeContainer || !expiredContainer) return;

    activeContainer.innerHTML = '';
    expiredContainer.innerHTML = '';

    const today = new Date();
    const currYear = today.getFullYear();
    const currWeek = getISOWeek(today);
    const monCurr = getMondayOfISOWeek(currYear, currWeek);

    const activeHabits = [];
    const expiredHabits = [];

    userHabits.forEach(h => {
        const hStart = new Date(h.start_date);
        let hEnd = null;
        if (h.duration_weeks > 0) {
            hEnd = new Date(hStart);
            hEnd.setDate(hEnd.getDate() + (h.duration_weeks * 7));
        }

        const isExpired = (hEnd !== null && hEnd < monCurr);
        if (isExpired) expiredHabits.push(h);
        else activeHabits.push(h);
    });

    if (activeHabits.length === 0) activeContainer.innerHTML = `<div class="col-span-2 text-center p-6 bg-gray-800 rounded-xl text-gray-400 italic">Keine aktiven Habits.</div>`;
    else activeHabits.forEach(h => activeContainer.appendChild(renderHabitCard(h, false)));

    if (expiredHabits.length === 0) expiredContainer.innerHTML = `<div class="col-span-2 text-center p-6 bg-gray-800 rounded-xl text-gray-400 italic">Keine abgelaufenen Habits.</div>`;
    else expiredHabits.forEach(h => expiredContainer.appendChild(renderHabitCard(h, true)));
}

function renderHabitCard(h, isExpired) {
    const today = new Date();
    const currYear = today.getFullYear();
    const currWeek = getISOWeek(today);

    const streak = calculateHabitStreak(h, userLogs);
    const durationText = h.duration_weeks > 0 ? `${h.duration_weeks} Wochen` : 'Unbegrenzt';
    const safeName = h.name.replace(/'/g, "\\'");
    const card = document.createElement('div');
    card.className = "bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-md flex flex-col justify-between space-y-4";

    const reactivateBtn = isExpired ? `
        <button onclick='openReactivateModal(${JSON.stringify(h)})' class="bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-300 font-semibold text-xs px-3 py-1.5 rounded-md border border-emerald-700/50 transition">
            🔄 Reaktivieren
        </button>
    ` : '';

    card.innerHTML = `
        <div>
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-2.5">
                    <span class="w-3.5 h-3.5 rounded-full inline-block shrink-0" style="background-color: ${h.color};"></span>
                    <div>
                        <h3 class="font-bold text-lg text-white">${h.name}</h3>
                        ${streak > 0 ? `<span class="text-xs font-bold text-orange-400 bg-orange-950/50 px-2 py-0.5 rounded-full border border-orange-800/40 inline-flex items-center gap-1 mt-1">🔥 ${streak} Wochen Streak</span>` : ''}
                    </div>
                </div>
                <div class="flex items-center gap-1.5">
                    ${reactivateBtn}
                    <button onclick='openEditModal(${JSON.stringify(h)})' class="bg-gray-700 hover:bg-gray-600 text-indigo-300 font-semibold text-xs px-2.5 py-1.5 rounded-md border border-gray-600 transition">✏️</button>
                    <button onclick="promptDeleteHabit('${h.id}', '${safeName}', ${currYear}, ${currWeek})" class="bg-red-900/30 hover:bg-red-800/50 text-red-300 font-semibold text-xs px-2.5 py-1.5 rounded-md border border-red-700/50 transition">🗑️</button>
                </div>
            </div>
            <p class="text-xs text-gray-400 mb-3">${h.notes ? `📝 ${h.notes}` : 'Keine Notizen'}</p>
            <div class="grid grid-cols-2 gap-2 text-xs text-gray-300 bg-gray-750/50 p-2.5 rounded-lg border border-gray-700/50 mb-3">
                <div><span class="text-gray-400">Ziel:</span> <strong>${h.goal_days_per_week} Tage/Woche</strong></div>
                <div><span class="text-gray-400">XP/Tag:</span> <strong>+${h.xp_per_habit} XP</strong></div>
                <div><span class="text-gray-400">Start:</span> <strong>${h.start_date}</strong></div>
                <div><span class="text-gray-400">Dauer:</span> <strong>${durationText}</strong></div>
            </div>
        </div>
    `;
    return card;
}
// ==================== 9. STATS & CHALLENGES ====================
function renderStats() {
    const today = new Date();
    const currIsoYear = today.getFullYear();
    const currIsoWeek = getISOWeek(today);
    const currMonth = today.getMonth() + 1;
    const currQuarter = Math.floor(today.getMonth() / 3) + 1;

    const germanMonths = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

    const lblWeek = document.getElementById('label-week');
    const lblMonth = document.getElementById('label-month');
    const lblQuarter = document.getElementById('label-quarter');
    const lblYear = document.getElementById('label-year');

    if (lblWeek) lblWeek.innerText = `KW ${currIsoWeek}`;
    if (lblMonth) lblMonth.innerText = `${germanMonths[currMonth - 1]} ${currIsoYear}`;
    if (lblQuarter) lblQuarter.innerText = `Q${currQuarter} ${currIsoYear}`;
    if (lblYear) lblYear.innerText = `${currIsoYear}`;

    let totals = {
        week: { xp: 0, checkins: 0 },
        month: { xp: 0, checkins: 0 },
        quarter: { xp: 0, checkins: 0 },
        year: { xp: 0, checkins: 0 },
        all_time: { xp: 0, checkins: 0 }
    };

    const habitsMap = {};
    userHabits.forEach(h => habitsMap[h.id] = h);

    Object.values(userLogs).forEach(log => {
        if (log.is_skipped) return;

        let habitId = log.habitId;
        let logYear = log.year;
        let logWeek = log.week;

        if (!habitId || !logYear || !logWeek) {
            const parts = log.id ? log.id.split('_') : [];
            if (parts.length >= 3) {
                logYear = parseInt(parts[0]);
                logWeek = parseInt(parts[1]);
                habitId = parts[2];
            }
        }

        const habit = habitsMap[habitId];
        if (!habit || !logYear || !logWeek) return;

        const monday = getMondayOfISOWeek(logYear, logWeek);

				days.forEach((d, idx) => {
			if (log[d]) {
				const dayDate = new Date(monday);
				dayDate.setDate(dayDate.getDate() + idx);

				const dYear = dayDate.getFullYear();
				const dWeek = getISOWeek(dayDate);
				const dMonth = dayDate.getMonth() + 1;
				const dQuarter = Math.floor(dayDate.getMonth() / 3) + 1;

				// Historischen XP-Wert aus dem Log oder aktuellen Fallback nutzen
				const effectiveXp = log.xp_per_habit !== undefined ? log.xp_per_habit : (habit.xp_per_habit || 5.0);

				totals.all_time.xp += effectiveXp;
				totals.all_time.checkins++;

				if (dYear === currIsoYear) {
					totals.year.xp += effectiveXp;
					totals.year.checkins++;

					if (dQuarter === currQuarter) {
						totals.quarter.xp += effectiveXp;
						totals.quarter.checkins++;
					}
					if (dMonth === currMonth) {
						totals.month.xp += effectiveXp;
						totals.month.checkins++;
					}
				}
				if (dYear === currIsoYear && dWeek === currIsoWeek) {
					totals.week.xp += effectiveXp;
					totals.week.checkins++;
				}
			}
		});
    });

    ['week', 'month', 'quarter', 'year', 'all_time'].forEach(tf => {
        const xp = Math.round(totals[tf].xp * 10) / 10;
        const checkins = totals[tf].checkins;

        const levelStep = userSettings.xpPerLevel || 100;
        const level = Math.floor(xp / levelStep) + 1;
        const levelXp = Math.round((xp % levelStep) * 10) / 10;
        const levelPct = Math.min(100, Math.round((levelXp / levelStep) * 100));

        if (tf === 'all_time') {
            const elLvl = document.getElementById('stat-alltime-level');
            const elXp = document.getElementById('stat-alltime-xp');
            const elCheck = document.getElementById('stat-alltime-checkins');
            const elProg = document.getElementById('stat-alltime-progress-text');
            const elBar = document.getElementById('stat-alltime-bar');

            if (elLvl) elLvl.innerText = `Level ${level}`;
            if (elXp) elXp.innerText = `${xp} XP`;
            if (elCheck) elCheck.innerText = `${checkins} Check-ins gesamt`;
            if (elProg) elProg.innerText = `${levelXp} / ${levelStep} XP bis Lvl ${level + 1}`;
            if (elBar) elBar.style.width = `${levelPct}%`;
        } else {
            const elLvl = document.getElementById(`stat-${tf}-level`);
            const elXp = document.getElementById(`stat-${tf}-xp`);
            const elCheck = document.getElementById(`stat-${tf}-checkins`);
            const elBar = document.getElementById(`stat-${tf}-bar`);

            if (elLvl) elLvl.innerText = `Level ${level}`;
            if (elXp) elXp.innerText = `+${xp} XP`;
            if (elCheck) elCheck.innerText = `${checkins} Check-ins`;
            if (elBar) elBar.style.width = `${levelPct}%`;
        }
    });
}
// ==================== 10. HELPER FUNCTIONS ====================
function getISOWeek(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function getMondayOfISOWeek(y, w) {
    const simple = new Date(y, 0, 1 + (w - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4) ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    else ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    return ISOweekStart;
}

function isWeekArchived(year, week) {
    const today = new Date();
    const currY = today.getFullYear();
    const currW = getISOWeek(today);
    const diff = (currY - year) * 52 + (currW - week);
    return diff > 8;
}

function toggleWeekAccordion(weekKey) {
    const content = document.getElementById(`content-${weekKey}`);
    const arrow = document.getElementById(`arrow-${weekKey}`);
    if (!content) return;

    const isHidden = content.classList.contains('hidden');
    if (isHidden) {
        content.classList.remove('hidden');
        if (arrow) arrow.classList.add('rotate-90');
        openWeeks.add(weekKey);
    } else {
        content.classList.add('hidden');
        if (arrow) arrow.classList.remove('rotate-90');
        openWeeks.delete(weekKey);
    }
}

function calculateHabitStreak(habit, userLogs) {
    let streak = 0;
    let today = new Date();
    let currYear = today.getFullYear();
    let currWeek = getISOWeek(today);

    let checkDate = new Date(today);

    // Bis zu 52 Wochen in der Vergangenheit prüfen
    for (let i = 0; i < 52; i++) {
        let y = checkDate.getFullYear();
        let w = getISOWeek(checkDate);

        let mon = getMondayOfISOWeek(y, w);
        let sun = new Date(mon); 
        sun.setDate(sun.getDate() + 6);

        let hStart = new Date(habit.start_date);
        let hEnd = habit.duration_weeks > 0 ? new Date(hStart.getTime() + habit.duration_weeks * 7 * 86400000) : null;

        // Wenn das Habit in dieser Woche noch gar nicht existierte
        if (hStart > sun) {
            checkDate.setDate(checkDate.getDate() - 7);
            continue;
        }
        // Wenn das Habit zu diesem Zeitpunkt bereits abgelaufen war
        if (hEnd && hEnd < mon) {
            break;
        }

        let logKey = `${y}_${w}_${habit.id}`;
        let log = userLogs[logKey];

        if (log && log.is_skipped) {
            checkDate.setDate(checkDate.getDate() - 7);
            continue;
        }

        let effectiveGoal = (log && log.goal_days_per_week !== undefined) ? log.goal_days_per_week : habit.goal_days_per_week;
        let doneCount = log ? days.filter(d => log[d]).length : 0;

        // Ist die Woche die aktuelle Woche?
        if (y === currYear && w === currWeek) {
            // Wenn das Ziel diese Woche schon erreicht ist, zählen wir es mit. 
            // Wenn nicht, bricht die Serie wegen der laufenden Woche noch nicht ab.
            if (doneCount >= effectiveGoal) {
                streak++;
            }
        } else {
            // Vergangene Woche: Ziel erreicht? Dann Streak erhöhen, sonst abbrechen.
            if (doneCount >= effectiveGoal) {
                streak++;
            } else {
                break;
            }
        }

        checkDate.setDate(checkDate.getDate() - 7);
    }
    return streak;
}

function toggleDurationInput(mode) {
    let typeId = 'durationType', containerId = 'durationInputContainer';
    if (mode === 'edit') { typeId = 'editDurationType'; containerId = 'editDurationInputContainer'; }
    else if (mode === 'reactivate') { typeId = 'reactivateDurationType'; containerId = 'reactivateDurationInputContainer'; }

    const type = document.getElementById(typeId).value;
    const container = document.getElementById(containerId);
    if (type === 'custom') container.classList.remove('hidden');
    else container.classList.add('hidden');
}

function openModal() { document.getElementById('habitModal')?.classList.remove('hidden'); }

function closeModal() { document.getElementById('habitModal')?.classList.add('hidden'); }

async function exportData() {
    const backupData = { habits: userHabits, logs: userLogs, settings: userSettings };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `habit_tracker_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
}

async function resetData() {
    if (!currentUser) return;
    if (!confirm("Bist du sicher, dass du alle Daten (Habits & Logs) unwiderruflich löschen möchtest?")) return;

    try {
        const batch = db.batch();
        const habitsSnap = await db.collection('users').doc(currentUser.uid).collection('habits').get();
        habitsSnap.forEach(doc => batch.delete(doc.ref));

        const logsSnap = await db.collection('users').doc(currentUser.uid).collection('logs').get();
        logsSnap.forEach(doc => batch.delete(doc.ref));

        await batch.commit();
        alert("Alle Daten wurden erfolgreich zurückgesetzt.");
        refreshCurrentTab();
    } catch (err) {
        alert("Fehler beim Zurücksetzen der Daten: " + err.message);
    }
}

async function enablePushNotifications() {
    if (!currentUser) return alert("Bitte melde dich zuerst an!");

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            // Warten, bis der Service Worker im Browser voll aktiv ist
            const registration = await navigator.serviceWorker.ready;

            // FCM Token mit der aktiven Registrierung anfordern
            const token = await messaging.getToken({ 
                vapidKey: 'DEIN_VAPID_KEY_HIER', // Achte darauf, dass hier dein echter Key steht!
                serviceWorkerRegistration: registration 
            });

            if (token) {
                await db.collection('users').doc(currentUser.uid).set({ fcmToken: token }, { merge: true });
                
                userSettings.pushEnabled = true;
                await saveGamificationSettings();
                
                alert("Push-Benachrichtigungen erfolgreich aktiviert! 🚀");
            } else {
                alert("Kein Token erhalten. Bitte versuche es erneut.");
            }
        } else {
            alert("Du hast die Benachrichtigungen blockiert. Bitte in den Browser-Einstellungen erlauben.");
        }
    } catch (error) {
        console.error("Fehler bei Push-Aktivierung:", error);
        alert("Fehler: " + error.message);
    }
}