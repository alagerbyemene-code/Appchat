// متغيرات عامة
let socket;
let currentUser = null;
let currentRoom = 1;
let isRecording = false;
let mediaRecorder;
let audioChunks = [];
let chatMode = 'public'; // public or private
let selectedUserId = null;
let quotedMessage = null;

// الرتب المتاحة
const RANKS = {
    visitor: { name: 'زائر', emoji: '👋', level: 0, color: '#888' },
    bronze: { name: 'عضو برونزي', emoji: '🥉', level: 1, color: '#cd7f32' },
    silver: { name: 'عضو فضي', emoji: '🥈', level: 2, color: '#c0c0c0' },
    gold: { name: 'عضو ذهبي', emoji: '🥇', level: 3, color: '#ffd700' },
    trophy: { name: 'مالك الموقع', emoji: '🏆', level: 4, color: '#ff6b35' },
    diamond: { name: 'عضو الماس', emoji: '💎', level: 5, color: '#b9f2ff' },
    prince: { name: 'برنس', emoji: '👑', level: 6, color: 'linear-gradient(45deg, #ffd700, #ff6b35)' },
    admin: { name: 'إداري', emoji: '⚡', level: 7, color: 'linear-gradient(45deg, #ff6b35, #f093fb)' },
};

// أسئلة المسابقات
const QUIZ_QUESTIONS = [
    {
        question: "ما هي عاصمة فرنسا؟",
        options: ["لندن", "برلين", "باريس", "روما"],
        correct: 2
    },
    {
        question: "كم عدد قارات العالم؟",
        options: ["5", "6", "7", "8"],
        correct: 2
    },
    {
        question: "ما هو أكبر محيط في العالم؟",
        options: ["الأطلسي", "الهندي", "المتجمد الشمالي", "الهادئ"],
        correct: 3
    },
    {
        question: "في أي عام تم اختراع الإنترنت؟",
        options: ["1969", "1975", "1983", "1991"],
        correct: 0
    },
    {
        question: "ما هو أطول نهر في العالم؟",
        options: ["النيل", "الأمازون", "اليانغتسي", "المسيسيبي"],
        correct: 0
    }
];

// تهيئة التطبيق
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    checkAuthStatus();
});

// تهيئة التطبيق
function initializeApp() {
    // إخفاء جميع الشاشات
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });

    // عرض شاشة تسجيل الدخول
    document.getElementById('loginScreen').classList.add('active');

    // تهيئة الأصوات
    initializeAudio();
}

// إعداد مستمعي الأحداث
function setupEventListeners() {
    // تسجيل الدخول
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('guestForm').addEventListener('submit', handleGuestLogin);

    // إرسال الرسائل
    document.getElementById('messageInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // رفع الصور
    document.getElementById('imageInput').addEventListener('change', handleImageUpload);

    // تغيير الغرفة
    document.getElementById('roomSelect').addEventListener('change', changeRoom);

    // إغلاق المودالات عند النقر خارجها
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            closeAllModals();
        }
    });
}

// التحقق من حالة المصادقة
function checkAuthStatus() {
    const token = localStorage.getItem('chatToken');
    if (token) {
        // التحقق من صحة التوكن
        fetch('/api/user/profile', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => {
            if (response.ok) {
                return response.json();
            }
            throw new Error('Invalid token');
        })
        .then(user => {
            currentUser = user;
            showMainScreen();
            initializeSocket();
        })
        .catch(() => {
            localStorage.removeItem('chatToken');
            showLoginScreen();
        });
    } else {
        showLoginScreen();
    }
}

// عرض شاشة تسجيل الدخول
function showLoginScreen() {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('loginScreen').classList.add('active');
}

// عرض الشاشة الرئيسية
function showMainScreen() {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('mainScreen').classList.add('active');

    // تحديث معلومات المستخدم في الواجهة
    updateUserInterface();

    // تحميل الغرف
    loadRooms();

    // تحميل الرسائل
    loadMessages();
}

// فحص الصلاحيات حسب الرتبة
function hasRankPermission(requiredRank) {
    return currentUser && currentUser.rank >= requiredRank;
}

function checkMusicPermission() {
    return hasRankPermission(2); // الرتبة 2 فما فوق
}

function checkBackgroundPermission() {
    return hasRankPermission(2); // الرتبة 2 فما فوق
}

function checkAdminPermission() {
    return hasRankPermission(4); // الرتبة 4 فما فوق (مالك الموقع والإدارة)
}

// تحديث واجهة المستخدم
function updateUserInterface() {
    if (!currentUser) return;

    // تحديث معلومات المستخدم في الشريط العلوي
    document.getElementById('headerUserName').textContent = currentUser.display_name || currentUser.email;
    document.getElementById('headerUserRank').textContent = RANKS[currentUser.rank]?.name || 'زائر';

    // تحديث صورة المستخدم
    const avatarImg = document.getElementById('headerUserAvatar');
    if (currentUser.profile_image1) {
        avatarImg.src = currentUser.profile_image1;
    }

    // إظهار أزرار الإدارة حسب الدور
    const adminBtn = document.getElementById('adminPanelBtn');
    const roomsBtn = document.getElementById('roomsManagerBtn');
    const clearBtn = document.getElementById('clearChatBtn');

    if (checkAdminPermission()) {
        if (adminBtn) adminBtn.style.display = 'block';
        if (roomsBtn) roomsBtn.style.display = 'block';
        if (clearBtn) clearBtn.style.display = 'block';
    }

    // عرض أزرار المميزات للرتبة 2 فما فوق
    if (checkMusicPermission()) {
        const musicBtn = document.getElementById('uploadMusicBtn');
        if (musicBtn) musicBtn.style.display = 'block';
    }
    if (checkBackgroundPermission()) {
        const bgBtn = document.getElementById('uploadBackgroundBtn');
        if (bgBtn) bgBtn.style.display = 'block';
    }

    // تعيين دور المستخدم في الجسم
    document.body.setAttribute('data-user-role', currentUser.role);
}

// تهيئة Socket.IO
function initializeSocket() {
    const token = localStorage.getItem('chatToken');
    socket = io({
        auth: {
            token: token
        }
    });

    // الاتصال
    socket.on('connect', () => {
        console.log('متصل بالخادم');
        socket.emit('join', {
            userId: currentUser.id,
            displayName: currentUser.display_name,
            rank: currentUser.rank,
            email: currentUser.email,
            roomId: currentRoom,
            token: token
        });
    });

    // رسالة جديدة
    socket.on('newMessage', (message) => {
        displayMessage(message);
        playNotificationSound();
    });

    // رسالة خاصة جديدة
    socket.on('newPrivateMessage', (message) => {
        if (chatMode === 'private' && 
            (message.user_id === selectedUserId || message.receiver_id === currentUser.id)) {
            displayPrivateMessage(message);
        }
        playNotificationSound();
        updateNotificationCount();
    });

    // تحديث قائمة المستخدمين
    socket.on('roomUsersList', (users) => {
        updateUsersList(users);
    });

    // حذف رسالة
    socket.on('messageDeleted', (messageId) => {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.remove();
        }
    });

    // إشعار جديد
    socket.on('newNotification', (notification) => {
        showNotification(notification.message, notification.type || 'info');
        updateNotificationCount();
        notificationsList.push(notification);
    });

    // تحديث قائمة المتصلين
    socket.on('onlineUsersUpdated', (users) => {
        onlineUsersList = users;
        // تحديث العدد في الشريط الجانبي
        const sidebarCount = document.getElementById('onlineCount');
        if (sidebarCount) {
            sidebarCount.textContent = users.length;
        }

        // تحديث قائمة المتصلين في المودال إذا كان مفتوحاً
        const modal = document.getElementById('onlineUsersModal');
        if (modal && modal.classList.contains('modal') && modal.style.display !== 'none') {
            displayOnlineUsers();
        }
    });

    // قطع الاتصال
    socket.on('disconnect', () => {
        console.log('انقطع الاتصال بالخادم');
        showNotification('انقطع الاتصال بالخادم', 'error');
    });

    // معالجة أخطاء الأمان
    socket.on('error', (errorMessage) => {
        console.error('خطأ في الأمان:', errorMessage);
        showNotification('خطأ في الأمان: ' + errorMessage, 'error');
        // إعادة توجيه لصفحة تسجيل الدخول
        localStorage.removeItem('chatToken');
        showLoginScreen();
    });
}

// تسجيل الدخول
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showError('يرجى ملء جميع الحقول');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('chatToken', data.token);
            currentUser = data.user;
            showMainScreen();
            initializeSocket();
            showNotification('تم تسجيل الدخول بنجاح', 'success');
        } else {
            if (data.error.includes('محظور')) {
                showBanScreen(data.banReason || 'لم يتم تحديد سبب الحظر');
            } else {
                showError(data.error);
            }
        }
    } catch (error) {
        showError('حدث خطأ في الاتصال');
    } finally {
        showLoading(false);
    }
}

// إنشاء حساب جديد
async function handleRegister(e) {
    e.preventDefault();

    const displayName = document.getElementById('registerDisplayName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;

    if (!email || !password) {
        showError('يرجى ملء جميع الحقول المطلوبة');
        return;
    }

    if (password.length < 6) {
        showError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password, display_name: displayName })
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('chatToken', data.token);
            currentUser = data.user;
            showMainScreen();
            initializeSocket();
            showNotification('تم إنشاء الحساب بنجاح', 'success');
        } else {
            showError(data.error);
        }
    } catch (error) {
        showError('حدث خطأ في الاتصال');
    } finally {
        showLoading(false);
    }
}

// دخول كزائر
async function handleGuestLogin(e) {
    e.preventDefault();

    const name = document.getElementById('guestName').value;
    const age = document.getElementById('guestAge').value;
    const gender = document.getElementById('guestGender').value;

    if (!name || !age || !gender) {
        showError('يرجى ملء جميع الحقول');
        return;
    }

    if (age < 13 || age > 99) {
        showError('العمر يجب أن يكون بين 13 و 99 سنة');
        return;
    }

    // إنشاء مستخدم زائر مؤقت
    currentUser = {
        id: Date.now(),
        display_name: name,
        email: `guest_${Date.now()}@temp.com`,
        role: 'user',
        rank: 'visitor',
        age: parseInt(age),
        gender: gender,
        isGuest: true
    };

    showMainScreen();
    initializeSocket();
    showNotification('مرحباً بك كزائر', 'success');
}

// عرض شاشة الحظر
function showBanScreen(reason) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('banScreen').classList.add('active');
    document.getElementById('banReason').innerHTML = `<p>${reason}</p>`;
}

// التحقق من حالة الحظر
async function checkBanStatus() {
    const token = localStorage.getItem('chatToken');
    if (!token) {
        showLoginScreen();
        return;
    }

    try {
        const response = await fetch('/api/user/profile', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const user = await response.json();
            currentUser = user;
            showMainScreen();
            initializeSocket();
            showNotification('تم رفع الحظر', 'success');
        } else {
            showNotification('لا يزال الحظر ساري المفعول', 'error');
        }
    } catch (error) {
        showError('حدث خطأ في التحقق من حالة الحظر');
    }
}

// تحميل الغرف
async function loadRooms() {
    try {
        const token = localStorage.getItem('chatToken');
        const response = await fetch('/api/rooms', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const rooms = await response.json();
            updateRoomsSelect(rooms);
        }
    } catch (error) {
        console.error('خطأ في تحميل الغرف:', error);
    }
}

// تحديث قائمة الغرف
function updateRoomsSelect(rooms) {
    const select = document.getElementById('roomSelect');
    select.innerHTML = '';

    rooms.forEach(room => {
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = room.name;
        if (room.id === currentRoom) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

// تغيير الغرفة
function changeRoom() {
    const newRoomId = parseInt(document.getElementById('roomSelect').value);
    if (newRoomId !== currentRoom) {
        currentRoom = newRoomId;

        // إشعار الخادم بتغيير الغرفة
        if (socket) {
            socket.emit('changeRoom', newRoomId);
        }

        // تحديث اسم الغرفة
        const roomName = document.getElementById('roomSelect').selectedOptions[0].textContent;
        document.getElementById('currentRoomName').textContent = roomName;

        // مسح الرسائل وتحميل رسائل الغرفة الجديدة
        document.getElementById('messagesContainer').innerHTML = '';
        loadMessages();
    }
}

// تحميل الرسائل
async function loadMessages() {
    try {
        const token = localStorage.getItem('chatToken');
        if (!token && !currentUser?.isGuest) return;

        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`/api/messages/${currentRoom}`, { headers });

        if (response.ok) {
            const messages = await response.json();
            const container = document.getElementById('messagesContainer');
            container.innerHTML = '';

            messages.forEach(message => {
                displayMessage(message);
            });

            scrollToBottom();
        }
    } catch (error) {
        console.error('خطأ في تحميل الرسائل:', error);
    }
}

// عرض رسالة
function displayMessage(message) {
    const container = document.getElementById('messagesContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.user_id === currentUser?.id ? 'own' : ''}`;
    messageDiv.setAttribute('data-message-id', message.id);

    const rank = RANKS[message.rank] || RANKS.visitor;
    const time = new Date(message.timestamp).toLocaleTimeString('ar-SA', {
        hour: '2-digit',
        minute: '2-digit'
    });

    let messageContent = '';

    // محتوى الرسالة
    if (message.message) {
        messageContent = `<div class="message-text">${escapeHtml(message.message)}</div>`;
    } else if (message.voice_url) {
        messageContent = `<audio class="message-audio" controls>
            <source src="${message.voice_url}" type="audio/webm">
            متصفحك لا يدعم تشغيل الصوت
        </audio>`;
    } else if (message.image_url) {
        messageContent = `<img class="message-image" src="${message.image_url}" alt="صورة" onclick="openImageModal('${message.image_url}')">`;
    }

    messageDiv.innerHTML = `
        <img class="message-avatar" src="${message.profile_image1 || 'https://images.pexels.com/photos/771742/pexels-photo-771742.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop'}" 
             alt="صورة ${message.display_name}" onclick="openUserProfile(${message.user_id})">
        <div class="message-content" style="${message.message_background ? `background-image: url(${message.message_background})` : ''}">
            <div class="message-header">
                <span class="message-author rank-${message.rank}" onclick="openUserProfile(${message.user_id})">${escapeHtml(message.display_name)}</span>
                <span class="message-rank">${rank.emoji} ${rank.name}</span>
                <span class="message-time">${time}</span>
            </div>
            ${messageContent}
        </div>
    `;

    container.appendChild(messageDiv);
    scrollToBottom();
}

// إرسال رسالة
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) return;

    if (message.length > 1000) {
        showError('الرسالة طويلة جداً (الحد الأقصى 1000 حرف)');
        return;
    }

    if (socket) {
        const messageData = {
            message: message,
            roomId: currentRoom
        };

        // إضافة الاقتباس إذا كان موجوداً
        if (quotedMessage) {
            messageData.quoted_message_id = quotedMessage.id;
            messageData.quoted_author = quotedMessage.author;
            messageData.quoted_content = quotedMessage.content;
        }

        socket.emit('sendMessage', messageData);
        input.value = '';
        cancelQuote();
    }
}

// رفع صورة
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showError('يرجى اختيار صورة صحيحة');
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showError('حجم الصورة كبير جداً (الحد الأقصى 5 ميجابايت)');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);

    showLoading(true);

    fetch('/api/upload-image', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
        },
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.image_url && socket) {
            socket.emit('sendMessage', {
                image_url: data.image_url,
                roomId: currentRoom
            });
        } else {
            showError('فشل في رفع الصورة');
        }
    })
    .catch(error => {
        showError('حدث خطأ في رفع الصورة');
    })
    .finally(() => {
        showLoading(false);
        e.target.value = '';
    });
}

// تسجيل صوتي
function toggleVoiceRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

// بدء التسجيل
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            uploadVoiceMessage(audioBlob);
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        isRecording = true;

        const voiceBtn = document.getElementById('voiceBtn');
        voiceBtn.classList.add('recording');
        voiceBtn.innerHTML = '<i class="fas fa-stop"></i>';

        showNotification('بدأ التسجيل...', 'info');
    } catch (error) {
        showError('لا يمكن الوصول للميكروفون');
    }
}

// إيقاف التسجيل
function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;

        const voiceBtn = document.getElementById('voiceBtn');
        voiceBtn.classList.remove('recording');
        voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';

        showNotification('تم إيقاف التسجيل', 'success');
    }
}

// رفع رسالة صوتية
function uploadVoiceMessage(audioBlob) {
    const formData = new FormData();
    formData.append('voice', audioBlob, 'voice.webm');

    showLoading(true);

    fetch('/api/upload-voice', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
        },
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.voice_url && socket) {
            socket.emit('sendMessage', {
                voice_url: data.voice_url,
                roomId: currentRoom
            });
        } else {
            showError('فشل في رفع التسجيل الصوتي');
        }
    })
    .catch(error => {
        showError('حدث خطأ في رفع التسجيل الصوتي');
    })
    .finally(() => {
        showLoading(false);
    });
}

// تحديث قائمة المستخدمين
function updateUsersList(users) {
    const container = document.getElementById('onlineUsersList');
    const countElement = document.getElementById('onlineCount');

    container.innerHTML = '';
    countElement.textContent = users.length;

    // ترتيب المستخدمين حسب الرتبة
    users.sort((a, b) => {
        const rankA = RANKS[a.rank] || RANKS.visitor;
        const rankB = RANKS[b.rank] || RANKS.visitor;
        return rankB.level - rankA.level;
    });

    users.forEach(user => {
        if (user.userId === currentUser?.id) return; // لا نعرض المستخدم الحالي

        const userDiv = document.createElement('div');
        userDiv.className = 'user-item';
        userDiv.onclick = () => openUserActions(user);

        const rank = RANKS[user.rank] || RANKS.visitor;

        userDiv.innerHTML = `
            <img class="user-avatar" src="https://images.pexels.com/photos/771742/pexels-photo-771742.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop" alt="${user.displayName}">
            <div class="user-details">
                <div class="user-display-name rank-${user.rank}">${escapeHtml(user.displayName)}</div>
                <div class="user-status">${rank.emoji} ${rank.name}</div>
            </div>
        `;

        container.appendChild(userDiv);
    });
}

// فتح إجراءات المستخدم
function openUserActions(user) {
    selectedUserId = user.userId;

    document.getElementById('actionUserName').textContent = user.displayName;
    document.getElementById('actionUserAvatar').src = 'https://images.pexels.com/photos/771742/pexels-photo-771742.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop';

    openModal('userActionsModal');
}

// بدء دردشة خاصة
function startPrivateChat() {
    if (!selectedUserId) return;

    chatMode = 'private';
    document.getElementById('chatModeText').textContent = 'خاص';

    // تحديث واجهة الدردشة الخاصة
    loadPrivateMessages();
    closeAllModals();

    showNotification('تم التبديل للدردشة الخاصة', 'info');
}

// تحميل الرسائل الخاصة
async function loadPrivateMessages() {
    if (!selectedUserId) return;

    try {
        const token = localStorage.getItem('chatToken');
        const response = await fetch(`/api/private-messages/${selectedUserId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const messages = await response.json();
            const container = document.getElementById('messagesContainer');
            container.innerHTML = '';

            messages.forEach(message => {
                displayPrivateMessage(message);
            });

            scrollToBottom();
        }
    } catch (error) {
        console.error('خطأ في تحميل الرسائل الخاصة:', error);
    }
}

// عرض رسالة خاصة
function displayPrivateMessage(message) {
    const container = document.getElementById('messagesContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.user_id === currentUser?.id ? 'own' : ''}`;
    messageDiv.setAttribute('data-message-id', message.id);

    const rank = RANKS[message.rank] || RANKS.visitor;
    const time = new Date(message.timestamp).toLocaleTimeString('ar-SA', {
        hour: '2-digit',
        minute: '2-digit'
    });

    let messageContent = '';

    if (message.message) {
        messageContent = `<div class="message-text">${escapeHtml(message.message)}</div>`;
    } else if (message.voice_url) {
        messageContent = `<audio class="message-audio" controls>
            <source src="${message.voice_url}" type="audio/webm">
        </audio>`;
    } else if (message.image_url) {
        messageContent = `<img class="message-image" src="${message.image_url}" alt="صورة" onclick="openImageModal('${message.image_url}')">`;
    }

    messageDiv.innerHTML = `
        <img class="message-avatar" src="https://images.pexels.com/photos/771742/pexels-photo-771742.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop" alt="${message.display_name}">
        <div class="message-content">
            <div class="message-header">
                <span class="message-author rank-${message.rank}">${escapeHtml(message.display_name)}</span>
                <span class="message-rank">${rank.emoji} ${rank.name}</span>
                <span class="message-time">${time}</span>
            </div>
            ${messageContent}
        </div>
    `;

    container.appendChild(messageDiv);
    scrollToBottom();
}

// تبديل وضع الدردشة
function toggleChatMode() {
    if (chatMode === 'public') {
        // التبديل للخاص يتطلب اختيار مستخدم
        showNotification('اختر مستخدماً لبدء دردشة خاصة', 'info');
    } else {
        // العودة للعام
        chatMode = 'public';
        selectedUserId = null;
        document.getElementById('chatModeText').textContent = 'عام';
        loadMessages();
        showNotification('تم التبديل للدردشة العامة', 'info');
    }
}

// فتح القائمة الرئيسية
function openMainMenu() {
    openModal('mainMenuModal');
}

// إغلاق القائمة الرئيسية
function closeMainMenu() {
    closeModal('mainMenuModal');
}

// فتح قسم الأخبار
function openNewsSection() {
    openModal('newsModal');
    loadNews();
    closeMainMenu();
}

// تحميل الأخبار
async function loadNews() {
    try {
        const response = await fetch('/api/news');
        if (response.ok) {
            const news = await response.json();
            displayNews(news);
        }
    } catch (error) {
        console.error('خطأ في تحميل الأخبار:', error);
    }
}

// عرض الأخبار
function displayNews(news) {
    const container = document.getElementById('newsFeed');
    container.innerHTML = '';

    if (news.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">لا توجد أخبار حالياً</p>';
        return;
    }

    news.forEach(item => {
        const newsDiv = document.createElement('div');
        newsDiv.className = 'news-item';

        const time = new Date(item.timestamp).toLocaleString('ar-SA');

        newsDiv.innerHTML = `
            <div class="news-header-info">
                <img class="news-author-avatar" src="https://images.pexels.com/photos/771742/pexels-photo-771742.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop" alt="${item.display_name}">
                <div class="news-author-info">
                    <h4>${escapeHtml(item.display_name)}</h4>
                    <span class="news-time">${time}</span>
                </div>
            </div>
            <div class="news-content">${escapeHtml(item.content)}</div>
            ${item.media ? `<div class="news-media"><img src="${item.media}" alt="صورة الخبر"></div>` : ''}
        `;

        container.appendChild(newsDiv);
    });
}

// نشر خبر
async function postNews() {
    const content = document.getElementById('newsContentInput').value.trim();
    const fileInput = document.getElementById('newsFileInput');

    if (!content && !fileInput.files[0]) {
        showError('يرجى كتابة محتوى أو اختيار ملف');
        return;
    }

    const formData = new FormData();
    if (content) formData.append('content', content);
    if (fileInput.files[0]) formData.append('newsFile', fileInput.files[0]);

    try {
        showLoading(true);

        const response = await fetch('/api/news', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: formData
        });

        if (response.ok) {
            document.getElementById('newsContentInput').value = '';
            fileInput.value = '';
            loadNews();
            showNotification('تم نشر الخبر بنجاح', 'success');
        } else {
            const data = await response.json();
            showError(data.error || 'فشل في نشر الخبر');
        }
    } catch (error) {
        showError('حدث خطأ في نشر الخبر');
    } finally {
        showLoading(false);
    }
}

// إغلاق مودال الأخبار
function closeNewsModal() {
    closeModal('newsModal');
}

// فتح قسم القصص
function openStoriesSection() {
    openModal('storiesModal');
    loadStories();
    closeMainMenu();
}

// تحميل القصص
async function loadStories() {
    try {
        const response = await fetch('/api/stories');
        if (response.ok) {
            const stories = await response.json();
            displayStories(stories);
        }
    } catch (error) {
        console.error('خطأ في تحميل القصص:', error);
    }
}

// عرض القصص
function displayStories(stories) {
    const container = document.getElementById('storiesContainer');
    container.innerHTML = '';

    if (stories.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">لا توجد قصص حالياً</p>';
        return;
    }

    stories.forEach(story => {
        const storyDiv = document.createElement('div');
        storyDiv.className = 'story-item';
        storyDiv.onclick = () => viewStory(story);

        storyDiv.innerHTML = `<img src="${story.image}" alt="قصة ${story.display_name}">`;
        container.appendChild(storyDiv);
    });
}

// فتح مودال إضافة قصة
function openAddStoryModal() {
    openModal('addStoryModal');
}

// إغلاق مودال إضافة قصة
function closeAddStoryModal() {
    closeModal('addStoryModal');
}

// إضافة قصة
async function addStory() {
    const fileInput = document.getElementById('storyMediaInput');
    const text = document.getElementById('storyTextInput').value.trim();

    if (!fileInput.files[0]) {
        showError('يرجى اختيار صورة أو فيديو');
        return;
    }

    const formData = new FormData();
    formData.append('storyImage', fileInput.files[0]);
    if (text) formData.append('text', text);

    try {
        showLoading(true);

        const response = await fetch('/api/stories', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: formData
        });

        if (response.ok) {
            closeAddStoryModal();
            loadStories();
            showNotification('تم إضافة القصة بنجاح', 'success');
        } else {
            const data = await response.json();
            showError(data.error || 'فشل في إضافة القصة');
        }
    } catch (error) {
        showError('حدث خطأ في إضافة القصة');
    } finally {
        showLoading(false);
    }
}

// إغلاق مودال القصص
function closeStoriesModal() {
    closeModal('storiesModal');
}

// فتح قسم الألعاب
function openGamesSection() {
    showNotification('الألعاب قيد التطوير', 'info');
    closeMainMenu();
}

// فتح غرفة المسابقات
function openQuizRoom() {
    openModal('quizRoomModal');
    startQuiz();
    closeMainMenu();
}

// بدء المسابقة
function startQuiz() {
    const randomQuestion = QUIZ_QUESTIONS[Math.floor(Math.random() * QUIZ_QUESTIONS.length)];
    displayQuizQuestion(randomQuestion);
    startQuizTimer();
}

// عرض سؤال المسابقة
function displayQuizQuestion(question) {
    document.getElementById('questionText').textContent = question.question;

    const optionsContainer = document.getElementById('questionOptions');
    optionsContainer.innerHTML = '';

    question.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'option-btn';
        button.textContent = option;
        button.onclick = () => selectQuizAnswer(index, question.correct);
        optionsContainer.appendChild(button);
    });
}

// اختيار إجابة
function selectQuizAnswer(selected, correct) {
    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach((btn, index) => {
        btn.disabled = true;
        if (index === correct) {
            btn.style.background = 'var(--success-color)';
        } else if (index === selected && selected !== correct) {
            btn.style.background = 'var(--error-color)';
        }
    });

    if (selected === correct) {
        showNotification('إجابة صحيحة! +10 نقاط', 'success');
        updateUserCoins(10);
    } else {
        showNotification('إجابة خاطئة', 'error');
    }

    setTimeout(() => {
        startQuiz(); // سؤال جديد
    }, 3000);
}

// بدء مؤقت المسابقة
function startQuizTimer() {
    let timeLeft = 30;
    const timerElement = document.getElementById('quizTimer');

    const timer = setInterval(() => {
        timeLeft--;
        timerElement.textContent = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(timer);
            showNotification('انتهى الوقت!', 'warning');
            setTimeout(() => {
                startQuiz();
            }, 2000);
        }
    }, 1000);
}

// إغلاق غرفة المسابقات
function closeQuizRoom() {
    closeModal('quizRoomModal');
}

// فتح إدارة الغرف
function openRoomsManager() {
    showNotification('إدارة الغرف متاحة في لوحة الإدارة', 'info');
    closeMainMenu();
}

// فتح متجر النقاط
function openCoinsShop() {
    showNotification('متجر النقاط قيد التطوير', 'info');
    closeMainMenu();
}

// فتح لوحة الإدارة
function openAdminPanel() {
    if (!checkAdminPermission()) {
        showError('غير مسموح - للإداريين فقط');
        return;
    }

    openModal('adminModal');
    loadAdminData();
    closeMainMenu();
}

// تحميل بيانات الإدارة
async function loadAdminData() {
    await loadAllUsers();
    loadRanks();
}

// تحميل جميع المستخدمين
async function loadAllUsers() {
    try {
        const response = await fetch('/api/all-users', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            }
        });

        if (response.ok) {
            const users = await response.json();
            displayAdminUsers(users);
        }
    } catch (error) {
        console.error('خطأ في تحميل المستخدمين:', error);
    }
}

// عرض المستخدمين في لوحة الإدارة
function displayAdminUsers(users) {
    const container = document.getElementById('adminUsersList');
    container.innerHTML = '';

    users.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.className = 'admin-user-item';

        const rank = RANKS[user.rank] || RANKS.visitor;
        const joinDate = new Date(user.created_at).toLocaleDateString('ar-SA');

        userDiv.innerHTML = `
            <div class="admin-user-info">
                <img class="admin-user-avatar" src="${user.profile_image1 || 'https://images.pexels.com/photos/771742/pexels-photo-771742.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop'}" alt="${user.display_name}">
                <div class="admin-user-details">
                    <h4>${escapeHtml(user.display_name)}</h4>
                    <div class="admin-user-rank">${rank.emoji} ${rank.name} • انضم في ${joinDate}</div>
                </div>
            </div>
            <div class="admin-user-actions">
                <button class="admin-action-btn btn-info" onclick="openAssignRankModal(${user.id}, '${user.display_name}')">
                    <i class="fas fa-crown"></i> رتبة
                </button>
                <button class="admin-action-btn btn-warning" onclick="openBanUserModal(${user.id}, '${user.display_name}')">
                    <i class="fas fa-ban"></i> حظر
                </button>
                <button class="admin-action-btn btn-success" onclick="openGiveCoinsModal(${user.id}, '${user.display_name}')">
                    <i class="fas fa-coins"></i> نقاط
                </button>
            </div>
        `;

        container.appendChild(userDiv);
    });
}

// تحميل الرتب
function loadRanks() {
    const container = document.getElementById('ranksList');
    container.innerHTML = '';

    Object.entries(RANKS).forEach(([key, rank]) => {
        const rankDiv = document.createElement('div');
        rankDiv.className = 'rank-item';

        rankDiv.innerHTML = `
            <div class="rank-emoji">${rank.emoji}</div>
            <div class="rank-name">${rank.name}</div>
            <div class="rank-level">المستوى ${rank.level}</div>
        `;

        container.appendChild(rankDiv);
    });
}

// فتح مودال تعيين الرتبة
function openAssignRankModal(userId, userName) {
    document.getElementById('rankTargetUser').textContent = userName;
    document.getElementById('rankTargetUser').setAttribute('data-user-id', userId);

    // ملء قائمة الرتب
    const select = document.getElementById('newRankSelect');
    select.innerHTML = '';

    Object.entries(RANKS).forEach(([key, rank]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = `${rank.emoji} ${rank.name}`;
        select.appendChild(option);
    });

    openModal('assignRankModal');
}

// تأكيد تعيين الرتبة
async function confirmAssignRank() {
    const userId = document.getElementById('rankTargetUser').getAttribute('data-user-id');
    const newRank = document.getElementById('newRankSelect').value;
    const reason = document.getElementById('rankChangeReason').value.trim();

    if (!newRank) {
        showError('يرجى اختيار رتبة');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/assign-rank', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: JSON.stringify({
                userId: parseInt(userId),
                newRank,
                reason
            })
        });

        const data = await response.json();

        if (response.ok) {
            closeAssignRankModal();
            loadAllUsers();
            showNotification(data.message, 'success');
        } else {
            showError(data.error);
        }
    } catch (error) {
        showError('حدث خطأ في تعيين الرتبة');
    } finally {
        showLoading(false);
    }
}

// إغلاق مودال تعيين الرتبة
function closeAssignRankModal() {
    closeModal('assignRankModal');
    document.getElementById('rankChangeReason').value = '';
}

// فتح مودال حظر المستخدم
function openBanUserModal(userId, userName) {
    document.getElementById('banTargetUser').textContent = userName;
    document.getElementById('banTargetUser').setAttribute('data-user-id', userId);
    openModal('banUserModal');
}

// تأكيد حظر المستخدم
async function confirmBanUser() {
    const userId = document.getElementById('banTargetUser').getAttribute('data-user-id');
    const reason = document.getElementById('banReason').value.trim();
    const duration = document.getElementById('banDuration').value;

    if (!reason) {
        showError('يرجى كتابة سبب الحظر');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/ban', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: JSON.stringify({
                userId: parseInt(userId),
                reason,
                duration
            })
        });

        const data = await response.json();

        if (response.ok) {
            closeBanUserModal();
            loadAllUsers();
            showNotification(data.message, 'success');
        } else {
            showError(data.error);
        }
    } catch (error) {
        showError('حدث خطأ في حظر المستخدم');
    } finally {
        showLoading(false);
    }
}

// إغلاق مودال حظر المستخدم
function closeBanUserModal() {
    closeModal('banUserModal');
    document.getElementById('banReason').value = '';
}

// فتح مودال إهداء النقاط
function openGiveCoinsModal(userId, userName) {
    document.getElementById('coinsTargetUser').textContent = userName;
    document.getElementById('coinsTargetUser').setAttribute('data-user-id', userId);
    openModal('giveCoinsModal');
}

// إهداء النقاط
async function giveCoins() {
    const userId = document.getElementById('coinsTargetUser').getAttribute('data-user-id');
    const amount = document.getElementById('coinsAmount').value;
    const reason = document.getElementById('coinsReason').value;

    if (!amount || amount < 1 || amount > 10000) {
        showError('يرجى إدخال عدد صحيح من النقاط (1-10000)');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/give-coins', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: JSON.stringify({
                userId: parseInt(userId),
                amount: parseInt(amount),
                reason: reason
            })
        });

        const data = await response.json();

        if (response.ok) {
            closeGiveCoinsModal();
            loadAllUsers();
            showNotification(`تم إهداء ${amount} نقطة بنجاح`, 'success');
        } else {
            showError(data.error);
        }
    } catch (error) {
        showError('حدث خطأ في إهداء النقاط');
    } finally {
        showLoading(false);
    }
}

// إغلاق مودال إهداء النقاط
function closeGiveCoinsModal() {
    closeModal('giveCoinsModal');
    document.getElementById('coinsAmount').value = '';
    document.getElementById('coinsReason').value = '';
}

// إغلاق لوحة الإدارة
function closeAdminModal() {
    closeModal('adminModal');
}

// عرض تبويب الإدارة
function showAdminTab(tabName) {
    // إخفاء جميع التبويبات
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // إزالة الفئة النشطة من جميع الأزرار
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // عرض التبويب المحدد
    document.getElementById(`admin${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`).classList.add('active');

    // تفعيل الزر المحدد
    event.target.classList.add('active');
}

// فتح الملف الشخصي
function openProfileModal() {
    if (!currentUser) return;

    // ملء البيانات الحالية
    document.getElementById('displayNameInput').value = currentUser.display_name || '';
    document.getElementById('emailInput').value = currentUser.email || '';
    document.getElementById('ageInput').value = currentUser.age || '';
    document.getElementById('genderInput').value = currentUser.gender || '';
    document.getElementById('maritalStatusInput').value = currentUser.marital_status || '';
    document.getElementById('aboutMeInput').value = currentUser.about_me || '';

    // عرض الصور الحالية
    if (currentUser.profile_image1) {
        document.getElementById('profileImg1').src = currentUser.profile_image1;
    }
    if (currentUser.profile_image2) {
        document.getElementById('profileImg2').src = currentUser.profile_image2;
    }

    // عرض الإحصائيات
    document.getElementById('profileCoins').textContent = currentUser.coins || 2000;
    document.getElementById('profileRank').textContent = RANKS[currentUser.rank]?.name || 'زائر';

    openModal('profileModal');
}

// إغلاق الملف الشخصي
function closeProfileModal() {
    closeModal('profileModal');
}

// عرض تبويب الملف الشخصي
function showProfileTab(tabName) {
    // إخفاء جميع التبويبات
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // إزالة الفئة النشطة من جميع الأزرار
    document.querySelectorAll('.profile-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // عرض التبويب المحدد
    document.getElementById(`profile${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`).classList.add('active');

    // تفعيل الزر المحدد
    event.target.classList.add('active');
}

// تحديث الملف الشخصي
async function updateProfile() {
    const formData = new FormData();

    const displayName = document.getElementById('displayNameInput').value.trim();
    const email = document.getElementById('emailInput').value.trim();
    const newPassword = document.getElementById('newPasswordInput').value;
    const age = document.getElementById('ageInput').value;
    const gender = document.getElementById('genderInput').value;
    const maritalStatus = document.getElementById('maritalStatusInput').value;
    const aboutMe = document.getElementById('aboutMeInput').value.trim();

    if (displayName) formData.append('display_name', displayName);
    if (email) formData.append('email', email);
    if (newPassword) formData.append('password', newPassword);
    if (age) formData.append('age', age);
    if (gender) formData.append('gender', gender);
    if (maritalStatus) formData.append('marital_status', maritalStatus);
    if (aboutMe) formData.append('about_me', aboutMe);

    // إضافة الصور إذا تم اختيارها
    const profileFile1 = document.getElementById('profileFile1').files[0];
    const profileFile2 = document.getElementById('profileFile2').files[0];

    if (profileFile1) formData.append('profileImage1', profileFile1);
    if (profileFile2) formData.append('profileImage2', profileFile2);

    try {
        showLoading(true);

        const response = await fetch('/api/user/profile', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: formData
        });

        if (response.ok) {
            const updatedUser = await response.json();
            currentUser = { ...currentUser, ...updatedUser };
            updateUserInterface();
            showNotification('تم تحديث الملف الشخصي بنجاح', 'success');
        } else {
            const data = await response.json();
            showError(data.error || 'فشل في تحديث الملف الشخصي');
        }
    } catch (error) {
        showError('حدث خطأ في تحديث الملف الشخصي');
    } finally {
        showLoading(false);
    }
}

// فتح ملف شخصي لمستخدم آخر
function openUserProfile(userId) {
    // هذه الوظيفة ستكون متاحة لاحقاً
    showNotification('عرض الملف الشخصي قيد التطوير', 'info');
}

// فتح الإشعارات
function openNotifications() {
    openModal('notificationsModal');
    loadNotifications();
}

// تحميل الإشعارات
function loadNotifications() {
    const container = document.getElementById('notificationsList');
    container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">لا توجد إشعارات جديدة</p>';
}

// إغلاق الإشعارات
function closeNotificationsModal() {
    closeModal('notificationsModal');
}

// تحديث عدد الإشعارات
function updateNotificationCount() {
    const badge = document.getElementById('notificationCount');
    let count = parseInt(badge.textContent) || 0;
    count++;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'block' : 'none';
}

// فتح الإعدادات
function openSettings() {
    openModal('settingsModal');
}

// إغلاق الإعدادات
function closeSettingsModal() {
    closeModal('settingsModal');
}

// حفظ الإعدادات
function saveSettings() {
    const soundNotifications = document.getElementById('soundNotifications').checked;
    const saveChatHistory = document.getElementById('saveChatHistory').checked;

    localStorage.setItem('soundNotifications', soundNotifications);
    localStorage.setItem('saveChatHistory', saveChatHistory);

    showNotification('تم حفظ الإعدادات', 'success');
    closeSettingsModal();
}

// الخروج من الدردشة
function exitChat() {
    if (confirm('هل أنت متأكد من الخروج؟')) {
        logout();
    }
}

// الخروج من الغرفة
function exitRoom() {
    currentRoom = 1;
    document.getElementById('roomSelect').value = 1;
    changeRoom();
    closeSettingsModal();
    showNotification('تم الخروج من الغرفة', 'info');
}

// فتح المساعدة
function openHelpModal() {
    showNotification('المساعدة قيد التطوير', 'info');
}

// عرض الرتب
function showRanks() {
    let ranksText = 'الرتب المتاحة:\n\n';
    Object.values(RANKS).forEach(rank => {
        ranksText += `${rank.emoji} ${rank.name} (المستوى ${rank.level})\n`;
    });

    alert(ranksText);
}

// تنظيف الغرف
async function cleanRooms() {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
        showError('غير مسموح - للإداريين فقط');
        return;
    }

    if (confirm('هل أنت متأكد من تنظيف جميع الرسائل؟')) {
        try {
            const response = await fetch('/api/clean-rooms', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
                }
            });

            if (response.ok) {
                document.getElementById('messagesContainer').innerHTML = '';
                showNotification('تم تنظيف الغرفة بنجاح', 'success');
            } else {
                showError('فشل في تنظيف الغرفة');
            }
        } catch (error) {
            showError('حدث خطأ في تنظيف الغرفة');
        }
    }
}

// فتح مشغل الراديو
function openRadioPlayer() {
    openModal('radioPlayerModal');
}

// إغلاق مشغل الراديو
function closeRadioPlayer() {
    closeModal('radioPlayerModal');
}

// تشغيل محطة راديو
function playRadioStation(station) {
    showNotification(`تم تشغيل ${station}`, 'success');
    // هنا يمكن إضافة كود تشغيل الراديو الفعلي
}

// تبديل الراديو
function toggleRadio() {
    const btn = document.getElementById('radioPlayBtn');
    const icon = btn.querySelector('i');

    if (icon.classList.contains('fa-play')) {
        icon.classList.remove('fa-play');
        icon.classList.add('fa-pause');
        showNotification('تم تشغيل الراديو', 'success');
    } else {
        icon.classList.remove('fa-pause');
        icon.classList.add('fa-play');
        showNotification('تم إيقاف الراديو', 'info');
    }
}

// رفع موسيقى مخصصة
// رفع موسيقى مخصصة (للرتبة 2 فما فوق)
async function uploadCustomMusic() {
    if (!checkMusicPermission()) {
        showError('هذه الميزة متاحة للرتبة 2 فما فوق');
        return;
    }

    const fileInput = document.getElementById('customMusicInput');
    if (!fileInput || fileInput.files.length === 0) {
        showError('يرجى اختيار ملف صوتي');
        return;
    }

    const file = fileInput.files[0];
    if (!file.type.startsWith('audio/')) {
        showError('يرجى اختيار ملف صوتي صحيح');
        return;
    }

    const formData = new FormData();
    formData.append('music', file);

    try {
        showLoading(true);
        const response = await fetch('/api/upload-music', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: formData
        });

        const data = await response.json();
        
        if (response.ok) {
            showNotification('تم رفع الموسيقى بنجاح! يمكنك الآن تشغيلها', 'success');
            fileInput.value = '';
            // تحديث قائمة الموسيقى
            loadUserMusic();
        } else {
            showError(data.error || 'فشل في رفع الموسيقى');
        }
    } catch (error) {
        showError('حدث خطأ في رفع الموسيقى');
    } finally {
        showLoading(false);
    }
}

// رفع خلفية مخصصة (للرتبة 2 فما فوق)
async function uploadCustomBackground() {
    if (!checkBackgroundPermission()) {
        showError('هذه الميزة متاحة للرتبة 2 فما فوق');
        return;
    }

    const fileInput = document.getElementById('customBackgroundInput');
    if (!fileInput || fileInput.files.length === 0) {
        showError('يرجى اختيار صورة خلفية');
        return;
    }

    const file = fileInput.files[0];
    if (!file.type.startsWith('image/')) {
        showError('يرجى اختيار صورة صحيحة');
        return;
    }

    const formData = new FormData();
    formData.append('background', file);

    try {
        showLoading(true);
        const response = await fetch('/api/upload-background', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: formData
        });

        const data = await response.json();
        
        if (response.ok) {
            showNotification('تم رفع الخلفية بنجاح! يمكنك تطبيقها على رسائلك', 'success');
            fileInput.value = '';
            // تحديث قائمة الخلفيات
            loadUserBackgrounds();
        } else {
            showError(data.error || 'فشل في رفع الخلفية');
        }
    } catch (error) {
        showError('حدث خطأ في رفع الخلفية');
    } finally {
        showLoading(false);
    }
}

// تبديل مشغل الموسيقى
function toggleMusicPlayer() {
    const btn = document.getElementById('musicToggle');
    const nowPlaying = document.getElementById('nowPlaying');

    if (nowPlaying.style.display === 'none') {
        nowPlaying.style.display = 'block';
        nowPlaying.querySelector('.song-title').textContent = 'تشغيل الموسيقى...';
        showNotification('تم تشغيل الموسيقى', 'success');
    } else {
        nowPlaying.style.display = 'none';
        showNotification('تم إيقاف الموسيقى', 'info');
    }
}

// تسجيل الخروج
function logout() {
    localStorage.removeItem('chatToken');
    currentUser = null;

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    showLoginScreen();
    showNotification('تم تسجيل الخروج', 'info');
}

// إعادة تحميل الصفحة
function reloadPage() {
    location.reload();
}

// تحديث نقاط المستخدم
function updateUserCoins(amount) {
    if (currentUser) {
        currentUser.coins = (currentUser.coins || 2000) + amount;
        document.getElementById('profileCoins').textContent = currentUser.coins;
    }
}

// فتح منتقي الرموز التعبيرية
function openEmojiPicker() {
    const emojis = ['😀', '😂', '😍', '🥰', '😎', '🤔', '😢', '😡', '👍', '👎', '❤️', '🔥', '💯', '🎉', '🦂'];
    const input = document.getElementById('messageInput');

    let emojiHtml = '<div style="background: white; border: 1px solid #ccc; border-radius: 8px; padding: 10px; position: absolute; z-index: 1000; display: flex; flex-wrap: wrap; gap: 5px; max-width: 200px;">';

    emojis.forEach(emoji => {
        emojiHtml += `<span style="cursor: pointer; padding: 5px; border-radius: 4px; hover: background: #f0f0f0;" onclick="addEmoji('${emoji}')">${emoji}</span>`;
    });

    emojiHtml += '</div>';

    // إضافة منتقي الرموز بجانب حقل الإدخال
    const picker = document.createElement('div');
    picker.innerHTML = emojiHtml;
    picker.style.position = 'relative';

    input.parentNode.appendChild(picker);

    // إزالة المنتقي بعد 5 ثوان
    setTimeout(() => {
        picker.remove();
    }, 5000);
}

// إضافة رمز تعبيري
function addEmoji(emoji) {
    const input = document.getElementById('messageInput');
    input.value += emoji;
    input.focus();

    // إزالة منتقي الرموز
    const picker = input.parentNode.querySelector('div');
    if (picker) picker.remove();
}

// فتح منتقي الصور المتحركة
function openGifPicker() {
    showNotification('منتقي الصور المتحركة قيد التطوير', 'info');
}

// اقتباس رسالة
function quoteMessage(messageId, author, content) {
    quotedMessage = { id: messageId, author, content };

    const quotedDiv = document.getElementById('quotedMessage');
    quotedDiv.style.display = 'flex';
    quotedDiv.querySelector('.quoted-author').textContent = author;
    quotedDiv.querySelector('.quoted-text').textContent = content.substring(0, 50) + (content.length > 50 ? '...' : '');

    document.getElementById('messageInput').focus();
}

// إلغاء الاقتباس
function cancelQuote() {
    quotedMessage = null;
    document.getElementById('quotedMessage').style.display = 'none';
}

// فتح صورة في مودال
function openImageModal(imageUrl) {
    const modal = document.createElement('div');
    modal.className = 'modal show';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 90vw; max-height: 90vh; padding: 0; background: transparent; border: none; box-shadow: none;">
            <img src="${imageUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 12px;" onclick="this.parentElement.parentElement.remove()">
        </div>
    `;

    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };

    document.body.appendChild(modal);
}

// مسح الدردشة
async function clearChat() {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
        showError('غير مسموح - للإداريين فقط');
        return;
    }

    if (confirm('هل أنت متأكد من مسح جميع الرسائل في هذه الغرفة؟')) {
        try {
            const response = await fetch(`/api/rooms/${currentRoom}/clear`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
                }
            });

            if (response.ok) {
                document.getElementById('messagesContainer').innerHTML = '';
                showNotification('تم مسح الدردشة بنجاح', 'success');
            } else {
                showError('فشل في مسح الدردشة');
            }
        } catch (error) {
            showError('حدث خطأ في مسح الدردشة');
        }
    }
}

// إظهار تبويبات تسجيل الدخول
function showLoginTab(tabName) {
    // إخفاء جميع النماذج
    document.querySelectorAll('.auth-form').forEach(form => {
        form.classList.remove('active');
    });

    // إزالة الفئة النشطة من جميع الأزرار
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // عرض النموذج المحدد
    document.getElementById(`${tabName}Form`).classList.add('active');

    // تفعيل الزر المحدد
    event.target.classList.add('active');
}

// التمرير لأسفل
function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}

// إظهار رسالة خطأ
function showError(message) {
    const errorDiv = document.getElementById('loginError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.add('show');

        setTimeout(() => {
            errorDiv.classList.remove('show');
        }, 5000);
    } else {
        showNotification(message, 'error');
    }
}

// إظهار حالة التحميل
function showLoading(show) {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.style.display = show ? 'flex' : 'none';
    }
}

// إظهار إشعار
function showNotification(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // إزالة الإشعار بعد 5 ثوان
    setTimeout(() => {
        toast.remove();
    }, 5000);
}

// فتح مودال
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

// إغلاق مودال
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = 'auto';
    }
}

// إغلاق جميع المودالات
function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.remove('show');
    });
    document.body.style.overflow = 'auto';
}

// إغلاق إجراءات المستخدم
function closeUserActionsModal() {
    closeModal('userActionsModal');
    selectedUserId = null;
}

// تهيئة الأصوات
function initializeAudio() {
    // تحميل الأصوات المحفوظة
    const soundEnabled = localStorage.getItem('soundNotifications');
    if (soundEnabled !== null) {
        document.getElementById('soundNotifications').checked = soundEnabled === 'true';
    }
}

// تشغيل صوت الإشعار
function playNotificationSound() {
    const soundEnabled = document.getElementById('soundNotifications')?.checked;
    if (soundEnabled !== false) {
        const audio = document.getElementById('notificationSound');
        if (audio) {
            audio.play().catch(() => {
                // تجاهل الأخطاء إذا لم يتمكن من تشغيل الصوت
            });
        }
    }
}

// تنظيف HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// معالج الأخطاء العامة
window.addEventListener('error', function(e) {
    console.error('خطأ في التطبيق:', e.error);
    showNotification('حدث خطأ غير متوقع', 'error');
});

// معالج الأخطاء غير المعالجة
window.addEventListener('unhandledrejection', function(e) {
    console.error('خطأ غير معالج:', e.reason);
    showNotification('حدث خطأ في الشبكة', 'error');
});

// ==================== الميزات الجديدة ====================

// متغيرات الإشعارات والميزات الجديدة
let onlineUsersList = [];
let allUsersList = [];
let notificationsList = [];
let privateChatMinimized = false;
let currentPrivateChatUser = null;

// متغيرات للميزات الجديدة
var currentMusicPlayer = null;
var isContestActive = false;
var contestTimer = null;

// وظائف إرسال الصور
function openImagePicker() {
    const imageInput = document.createElement('input');
    imageInput.type = 'file';
    imageInput.accept = 'image/*';
    imageInput.multiple = true;

    imageInput.onchange = function(event) {
        const files = event.target.files;
        if (files.length > 0) {
            for (let i = 0; i < files.length; i++) {
                uploadImage(files[i]);
            }
        }
    };

    imageInput.click();
}

function uploadImage(file) {
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
        alert('حجم الصورة كبير جداً! الحد الأقصى 10 ميجابايت');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('roomId', currentRoomId);

    // عرض مؤشر التحميل
    showUploadProgress('جاري رفع الصورة...');

    fetch('/upload-image', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        hideUploadProgress();
        if (data.success) {
            // إرسال رسالة مع رابط الصورة
            socket.emit('sendMessage', {
                message: '',
                imageUrl: data.imageUrl,
                roomId: currentRoomId,
                type: 'image'
            });
        } else {
            alert('فشل في رفع الصورة: ' + data.message);
        }
    })
    .catch(error => {
        hideUploadProgress();
        console.error('خطأ في رفع الصورة:', error);
        alert('حدث خطأ أثناء رفع الصورة');
    });
}

function openPrivateImagePicker(receiverId) {
    const imageInput = document.createElement('input');
    imageInput.type = 'file';
    imageInput.accept = 'image/*';

    imageInput.onchange = function(event) {
        const file = event.target.files[0];
        if (file) {
            uploadPrivateImage(file, receiverId);
        }
    };

    imageInput.click();
}

function uploadPrivateImage(file, receiverId) {
    if (file.size > 10 * 1024 * 1024) { 
        alert('حجم الصورة كبير جداً! الحد الأقصى 10 ميجابايت');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('receiverId', receiverId);

    showUploadProgress('جاري رفع الصورة الخاصة...');

    fetch('/upload-private-image', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        hideUploadProgress();
        if (data.success) {
            socket.emit('sendPrivateMessage', {
                message: '',
                imageUrl: data.imageUrl,
                receiverId: receiverId,
                type: 'image'
            });
        } else {
            alert('فشل في رفع الصورة: ' + data.message);
        }
    })
    .catch(error => {
        hideUploadProgress();
        console.error('خطأ في رفع الصورة الخاصة:', error);
        alert('حدث خطأ أثناء رفع الصورة');
    });
}

function showUploadProgress(message) {
    const progressDiv = document.createElement('div');
    progressDiv.id = 'uploadProgress';
    progressDiv.className = 'upload-progress';
    progressDiv.innerHTML = `
        <div class="upload-progress-content">
            <div class="upload-spinner"></div>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(progressDiv);
}

function hideUploadProgress() {
    const progressDiv = document.getElementById('uploadProgress');
    if (progressDiv) {
        progressDiv.remove();
    }
}

// وظائف معاينة فيديو يوتيوب
function detectAndProcessYouTubeLinks(message) {
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
    const matches = message.match(youtubeRegex);

    if (matches) {
        matches.forEach(match => {
            const videoId = extractYouTubeVideoId(match);
            if (videoId) {
                message = message.replace(match, createYouTubeEmbed(videoId));
            }
        });
    }

    return message;
}

function extractYouTubeVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

function createYouTubeEmbed(videoId) {
    return `
        <div class="youtube-embed">
            <iframe 
                width="300" 
                height="200" 
                src="https://www.youtube.com/embed/${videoId}" 
                frameborder="0" 
                allowfullscreen>
            </iframe>
            <div class="youtube-info">
                <span>🎥 فيديو يوتيوب</span>
            </div>
        </div>
    `;
}

// وظائف حذف الرسائل
function deleteMessage(messageId, messageElement) {
    if (confirm('هل أنت متأكد من حذف هذه الرسالة؟')) {
        fetch('/delete-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('token')
            },
            body: JSON.stringify({ messageId: messageId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                messageElement.innerHTML = '<em>تم حذف هذه الرسالة</em>';
                messageElement.classList.add('deleted-message');
            } else {
                alert('فشل في حذف الرسالة: ' + data.message);
            }
        })
        .catch(error => {
            console.error('خطأ في حذف الرسالة:', error);
        });
    }
}

// وظائف الطرد والكتم
function kickUser(userId, userName) {
    if (confirm(`هل تريد طرد ${userName} من الغرفة؟`)) {
        socket.emit('kickUser', {
            userId: userId,
            roomId: currentRoomId
        });
    }
}

function muteUser(userId, userName) {
    const duration = prompt(`كم دقيقة تريد كتم ${userName}؟ (اترك فارغاً للكتم الدائم)`, '10');

    if (duration !== null) {
        const muteMinutes = duration === '' ? null : parseInt(duration);

        socket.emit('muteUser', {
            userId: userId,
            roomId: currentRoomId,
            duration: muteMinutes
        });
    }
}

function unmuteUser(userId, userName) {
    if (confirm(`هل تريد إلغاء كتم ${userName}؟`)) {
        socket.emit('unmuteUser', {
            userId: userId,
            roomId: currentRoomId
        });
    }
}

// وظائف إنشاء الغرف
function openCreateRoomModal() {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'createRoomModal';

    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeCreateRoomModal()">&times;</span>
            <h2>🏠 إنشاء غرفة جديدة</h2>

            <div class="room-form">
                <div class="form-group">
                    <label>اسم الغرفة:</label>
                    <input type="text" id="roomName" placeholder="ادخل اسم الغرفة">
                </div>

                <div class="form-group">
                    <label>وصف الغرفة:</label>
                    <textarea id="roomDescription" placeholder="ادخل وصف للغرفة"></textarea>
                </div>

                <div class="form-group">
                    <label>نوع الغرفة:</label>
                    <select id="roomType">
                        <option value="public">عامة</option>
                        <option value="private">خاصة</option>
                        <option value="contest">مسابقات</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>الحد الأقصى للمستخدمين:</label>
                    <input type="number" id="maxUsers" value="50" min="2" max="200">
                </div>

                <div class="room-actions">
                    <button onclick="createRoom()" class="btn save-btn">إنشاء الغرفة</button>
                    <button onclick="closeCreateRoomModal()" class="btn cancel-btn">إلغاء</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function closeCreateRoomModal() {
    const modal = document.getElementById('createRoomModal');
    if (modal) {
        modal.remove();
    }
}

function createRoom() {
    const roomName = document.getElementById('roomName').value.trim();
    const roomDescription = document.getElementById('roomDescription').value.trim();
    const roomType = document.getElementById('roomType').value;
    const maxUsers = parseInt(document.getElementById('maxUsers').value);

    if (!roomName) {
        alert('يرجى إدخال اسم الغرفة');
        return;
    }

    socket.emit('createRoom', {
        name: roomName,
        description: roomDescription,
        type: roomType,
        maxUsers: maxUsers
    });

    closeCreateRoomModal();
}

// ==================== وظائف الإشعارات ====================

// فتح مودال إرسال إشعار
function openSendNotificationModal() {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
        showNotification('غير مسموح - للإداريين فقط', 'error');
        return;
    }

    openModal('sendNotificationModal');
    loadUsersForNotification();
    closeMainMenu();
}

// إغلاق مودال إرسال إشعار
function closeSendNotificationModal() {
    closeModal('sendNotificationModal');
    document.getElementById('notificationMessage').value = '';
    document.getElementById('notificationRecipient').value = '';
}

// تحميل المستخدمين لقائمة الإشعارات
async function loadUsersForNotification() {
    try {
        const response = await fetch('/api/all-users-list', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            }
        });

        if (response.ok) {
            const users = await response.json();
            const select = document.getElementById('notificationRecipient');
            select.innerHTML = '<option value="">اختر مستخدم...</option>';

            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = `${user.display_name} (${RANKS[user.rank]?.name || 'زائر'})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('خطأ في تحميل المستخدمين:', error);
    }
}

// إرسال إشعار للمستخدم
async function sendNotificationToUser() {
    const recipientId = document.getElementById('notificationRecipient').value;
    const message = document.getElementById('notificationMessage').value.trim();
    const type = document.getElementById('notificationType').value;

    if (!recipientId) {
        showNotification('يرجى اختيار مستخدم', 'warning');
        return;
    }

    if (!message) {
        showNotification('يرجى كتابة رسالة الإشعار', 'warning');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/send-notification', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            },
            body: JSON.stringify({
                recipientId: parseInt(recipientId),
                message,
                type
            })
        });

        const data = await response.json();

        if (response.ok) {
            showNotification('تم إرسال الإشعار بنجاح', 'success');
            closeSendNotificationModal();
        } else {
            showNotification(data.error || 'فشل في إرسال الإشعار', 'error');
        }
    } catch (error) {
        showNotification('حدث خطأ في إرسال الإشعار', 'error');
    } finally {
        showLoading(false);
    }
}

// ==================== قائمة المتصلين حالياً ====================

// فتح مودال المتصلين حالياً
function openOnlineUsersModal() {
    openModal('onlineUsersModal');
    displayOnlineUsers();
    closeMainMenu();
}

// إغلاق مودال المتصلين حالياً
function closeOnlineUsersModal() {
    closeModal('onlineUsersModal');
}

// عرض المتصلين حالياً
function displayOnlineUsers() {
    const container = document.getElementById('onlineUsersList');

    if (onlineUsersList.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">لا يوجد مستخدمين متصلين حالياً</p>';
        return;
    }

    container.innerHTML = '';

    onlineUsersList.forEach(user => {
        if (user.userId === currentUser?.id) return; // لا نعرض المستخدم الحالي

        const userDiv = document.createElement('div');
        userDiv.className = 'online-user-item';

        const rank = RANKS[user.rank] || RANKS.visitor;

        userDiv.innerHTML = `
            <div class="online-user-info">
                <div class="online-status-indicator"></div>
                <div class="user-details">
                    <span class="user-name">${escapeHtml(user.displayName)}</span>
                    <span class="user-rank">${rank.emoji} ${rank.name}</span>
                </div>
            </div>
            <div class="online-user-actions">
                <button onclick="startPrivateChat(${user.userId}, '${escapeHtml(user.displayName)}')" class="btn btn-sm btn-primary" title="دردشة خاصة">
                    <i class="fas fa-comment"></i>
                </button>
                ${currentUser?.role === 'admin' || currentUser?.role === 'owner' ? `
                    <button onclick="openNotificationModalForUser(${user.userId}, '${escapeHtml(user.displayName)}')" class="btn btn-sm btn-info" title="إرسال إشعار">
                        <i class="fas fa-bell"></i>
                    </button>
                ` : ''}
            </div>
        `;

        container.appendChild(userDiv);
    });
}

// بدء دردشة خاصة
function startPrivateChat(userId, userName) {
    currentPrivateChatUser = { id: userId, name: userName };
    openPrivateChatBox();
    closeOnlineUsersModal();

    // تحديث قائمة المستخدمين في صندوق الدردشة الخاصة
    const select = document.getElementById('privateChatUserSelect');
    select.value = userId;

    // تحديث عنوان صندوق الدردشة
    const titleSpan = document.querySelector('.chat-box-title span');
    titleSpan.textContent = `دردشة خاصة مع ${userName}`;

    // تحميل الرسائل الخاصة
    loadPrivateMessages(userId);
}

// ==================== صندوق الدردشة الخاصة ====================

// فتح صندوق الدردشة الخاصة
function openPrivateChatBox() {
    const chatBox = document.getElementById('privateChatBox');
    chatBox.style.display = 'block';
    privateChatMinimized = false;

    // تحميل المستخدمين في القائمة
    loadUsersForPrivateChat();
    closeMainMenu();
}

// إغلاق صندوق الدردشة الخاصة
function closePrivateChatBox() {
    const chatBox = document.getElementById('privateChatBox');
    chatBox.style.display = 'none';
    currentPrivateChatUser = null;
}

// تصغير صندوق الدردشة الخاصة
function minimizePrivateChatBox() {
    const chatBox = document.getElementById('privateChatBox');
    const body = chatBox.querySelector('.chat-box-body');

    if (privateChatMinimized) {
        body.style.display = 'block';
        privateChatMinimized = false;
    } else {
        body.style.display = 'none';
        privateChatMinimized = true;
    }
}

// تحميل المستخدمين للدردشة الخاصة
async function loadUsersForPrivateChat() {
    try {
        const response = await fetch('/api/all-users-list', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            }
        });

        if (response.ok) {
            const users = await response.json();
            const select = document.getElementById('privateChatUserSelect');
            select.innerHTML = '<option value="">اختر مستخدم...</option>';

            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = `${user.display_name} ${user.is_online ? '🟢' : '🔴'}`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('خطأ في تحميل المستخدمين:', error);
    }
}

// إرسال رسالة خاصة
function sendPrivateChatMessage() {
    const input = document.getElementById('privateChatInput');
    const userSelect = document.getElementById('privateChatUserSelect');
    const message = input.value.trim();
    const receiverId = userSelect.value;

    if (!message) {
        showNotification('يرجى كتابة رسالة', 'warning');
        return;
    }

    if (!receiverId) {
        showNotification('يرجى اختيار مستخدم', 'warning');
        return;
    }

    if (socket) {
        socket.emit('sendPrivateMessage', {
            message: message,
            receiverId: parseInt(receiverId)
        });

        input.value = '';
    }
}

// عرض رسالة خاصة في صندوق الدردشة
function displayPrivateMessage(message) {
    const container = document.getElementById('privateChatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `private-message ${message.user_id === currentUser?.id ? 'own' : ''}`;

    const time = new Date(message.timestamp).toLocaleTimeString('ar-SA', {
        hour: '2-digit',
        minute: '2-digit'
    });

    messageDiv.innerHTML = `
        <div class="private-message-content">
            <div class="private-message-header">
                <span class="private-message-author">${escapeHtml(message.display_name)}</span>
                <span class="private-message-time">${time}</span>
            </div>
            <div class="private-message-text">${escapeHtml(message.message)}</div>
        </div>
    `;

    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

// تحميل الرسائل الخاصة
async function loadPrivateMessages(userId) {
    try {
        const response = await fetch(`/api/private-messages/${userId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            }
        });

        if (response.ok) {
            const messages = await response.json();
            const container = document.getElementById('privateChatMessages');
            container.innerHTML = '';

            if (messages.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد رسائل بعد، ابدأ المحادثة!</p>';
            } else {
                messages.forEach(message => {
                    displayPrivateMessage(message);
                });
            }
        }
    } catch (error) {
        console.error('خطأ في تحميل الرسائل الخاصة:', error);
    }
}

// تشغيل الأغنية تلقائياً في البروفايل
function autoPlayProfileMusic(musicUrl) {
    if (musicUrl) {
        const audio = new Audio(musicUrl);
        audio.volume = 0.3;
        audio.loop = false;

        // محاولة تشغيل الأغنية
        audio.play().catch(error => {
            console.log('لا يمكن تشغيل الأغنية تلقائياً:', error);
            // إضافة زر تشغيل إذا فشل التشغيل التلقائي
            addManualPlayButton(audio);
        });

        return audio;
    }
}

function addManualPlayButton(audio) {
    const playButton = document.createElement('button');
    playButton.innerHTML = '🎵 تشغيل الأغنية';
    playButton.className = 'play-music-btn';
    playButton.onclick = () => {
        audio.play();
        playButton.style.display = 'none';
    };

    const profileModal = document.querySelector('.modal.active .modal-content');
    if (profileModal) {
        profileModal.appendChild(playButton);
    }
}

// فتح مودال رفع الموسيقى
function openMusicUploadModal() {
    if (!checkMusicPermission()) {
        showError('هذه الميزة متاحة للرتبة 2 فما فوق');
        return;
    }
    openModal('musicUploadModal');
    loadUserMusic();
    closeMainMenu();
}

// إغلاق مودال رفع الموسيقى
function closeMusicUploadModal() {
    closeModal('musicUploadModal');
}

// فتح مودال رفع الخلفية
function openBackgroundUploadModal() {
    if (!checkBackgroundPermission()) {
        showError('هذه الميزة متاحة للرتبة 2 فما فوق');
        return;
    }
    openModal('backgroundUploadModal');
    loadUserBackgrounds();
    closeMainMenu();
}

// إغلاق مودال رفع الخلفية
function closeBackgroundUploadModal() {
    closeModal('backgroundUploadModal');
}

// تحميل موسيقى المستخدم
async function loadUserMusic() {
    try {
        const response = await fetch('/api/user/media', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            }
        });

        const data = await response.json();
        const musicContainer = document.getElementById('currentMusic');
        
        if (data.music) {
            musicContainer.innerHTML = `
                <div class="current-item">
                    <h4>الموسيقى الحالية:</h4>
                    <audio controls>
                        <source src="${data.music}" type="audio/mpeg">
                        المتصفح لا يدعم عنصر الصوت
                    </audio>
                </div>
            `;
        } else {
            musicContainer.innerHTML = '<p style="color: var(--text-secondary);">لم يتم رفع موسيقى بعد</p>';
        }
    } catch (error) {
        console.error('خطأ في تحميل الموسيقى:', error);
    }
}

// تحميل خلفيات المستخدم
async function loadUserBackgrounds() {
    try {
        const response = await fetch('/api/user/media', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            }
        });

        const data = await response.json();
        const backgroundContainer = document.getElementById('currentBackground');
        
        if (data.background) {
            backgroundContainer.innerHTML = `
                <div class="current-item">
                    <h4>الخلفية الحالية:</h4>
                    <img src="${data.background}" alt="خلفية الرسائل" style="max-width: 200px; max-height: 100px; border-radius: 8px;">
                </div>
            `;
        } else {
            backgroundContainer.innerHTML = '<p style="color: var(--text-secondary);">لم يتم رفع خلفية بعد</p>';
        }
    } catch (error) {
        console.error('خطأ في تحميل الخلفية:', error);
    }
}

// حذف موسيقى المستخدم
async function deleteUserMusic() {
    if (!checkMusicPermission()) {
        showError('هذه الميزة متاحة للرتبة 2 فما فوق');
        return;
    }

    if (!confirm('هل أنت متأكد من حذف الموسيقى؟')) return;

    try {
        showLoading(true);
        const response = await fetch('/api/user/music', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            }
        });

        const data = await response.json();
        
        if (response.ok) {
            showNotification('تم حذف الموسيقى بنجاح', 'success');
            loadUserMusic();
        } else {
            showError(data.error || 'فشل في حذف الموسيقى');
        }
    } catch (error) {
        showError('حدث خطأ في حذف الموسيقى');
    } finally {
        showLoading(false);
    }
}

// حذف خلفية المستخدم
async function deleteUserBackground() {
    if (!checkBackgroundPermission()) {
        showError('هذه الميزة متاحة للرتبة 2 فما فوق');
        return;
    }

    if (!confirm('هل أنت متأكد من حذف الخلفية؟')) return;

    try {
        showLoading(true);
        const response = await fetch('/api/user/background', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('chatToken')}`
            }
        });

        const data = await response.json();
        
        if (response.ok) {
            showNotification('تم حذف الخلفية بنجاح', 'success');
            loadUserBackgrounds();
        } else {
            showError(data.error || 'فشل في حذف الخلفية');
        }
    } catch (error) {
        showError('حدث خطأ في حذف الخلفية');
    } finally {
        showLoading(false);
    }
}
