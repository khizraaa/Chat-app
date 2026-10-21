import { auth, db } from "./firebase-config.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

import {
  collection,
  doc,
  setDoc,
  addDoc,
  query,
  orderBy,
  limitToLast,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// 3. HTML elements
const $ = (id) => document.getElementById(id);

const authScreen = $("authScreen");
const chatScreen = $("chatScreen");
const authForm = $("authForm");
const authTitle = $("authTitle");
const authSubtitle = $("authSubtitle");
const authSubmit = $("authSubmit");
const authSubmitText = $("authSubmitText");
const authError = $("authError");
const nameField = $("nameField");
const displayNameInput = $("displayName");
const emailInput = $("email");
const passwordInput = $("password");

const signupTab = $("signupTab");
const loginTab = $("loginTab");
const myAvatar = $("myAvatar");
const myName = $("myName");
const messagesBox = $("messages");
const messageForm = $("messageForm");
const messageInput = $("messageInput");
const sendBtn = $("sendBtn");
const sendError = $("sendError");
const emojiBtn = $("emojiBtn");
const emojiPicker = $("emojiPicker");
const connectionText = $("connectionText");
const toast = $("toast");

// Existing elements that change when you switch chats (HTML is not modified)
const globalChatBtn = $("globalChatBtn");
const sidebarHint = document.querySelector(".sidebar-hint");
const headerAvatar = document.querySelector(".chat-title-wrap .header-avatar");
const headerTitle = document.querySelector(".chat-title-wrap h2");
const headerSub = document.querySelector(".chat-title-wrap p");
const welcomeTitle = document.querySelector(".welcome-strip strong");
const welcomeText = document.querySelector(".welcome-strip p");

// List of people (created from JavaScript, uses your existing CSS classes)
const userListBox = document.createElement("div");
userListBox.id = "userList";
userListBox.style.cssText =
  "display:flex;flex-direction:column;gap:4px;margin-top:6px;" +
  "overflow-y:auto;min-height:0;max-height:38vh;";
sidebarHint.parentNode.insertBefore(userListBox, sidebarHint);

// Small chat switcher for phones (sidebar is hidden on small screens)
const pickerStyle = document.createElement("style");
pickerStyle.textContent = `
  #mobileChatPicker { display: none; padding: 10px 14px 0; }
  #mobileChatPicker select {
    width: 100%; padding: 11px 12px; border-radius: 12px;
    border: 1px solid #ffffff14; background: #151522; color: #fff;
    font: inherit; font-size: 14px;
  }
  @media (max-width: 600px) { #mobileChatPicker { display: block; } }
`;
document.head.appendChild(pickerStyle);

const mobilePicker = document.createElement("div");
mobilePicker.id = "mobileChatPicker";
const mobileSelect = document.createElement("select");
mobileSelect.setAttribute("aria-label", "Choose chat");
mobilePicker.appendChild(mobileSelect);
document.querySelector(".chat-header").after(mobilePicker);

mobileSelect.addEventListener("change", () => {
  if (mobileSelect.value === "global") {
    openChat(GLOBAL_CHAT);
    return;
  }
  const person = usersCache.find((u) => u.uid === mobileSelect.value);
  if (person) openChat({ type: "private", uid: person.uid, name: person.name });
});

function renderMobilePicker(others) {
  mobileSelect.replaceChildren();

  const globalOption = document.createElement("option");
  globalOption.value = "global";
  globalOption.textContent = "✦ Global Lounge";
  mobileSelect.appendChild(globalOption);

  others.forEach((person) => {
    const option = document.createElement("option");
    option.value = person.uid;
    option.textContent = person.name;
    mobileSelect.appendChild(option);
  });

  mobileSelect.value =
    activeChat.type === "private" ? activeChat.uid : "global";
}

const GLOBAL_CHAT = { type: "global" };

let authMode = "signup";
let currentUser = null;
let unsubscribeMessages = null;
let unsubscribeUsers = null;
let toastTimeout = null;
let toastCounter = 0;
let sending = false;
let signingUp = false;
let activeChat = GLOBAL_CHAT;
let usersCache = [];

// 4. Helpers
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  const counter = ++toastCounter;

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    if (counter === toastCounter) {
      toast.classList.remove("show");
    }
  }, 3500);
}

function friendlyError(error) {
  const code = error?.code || "";

  const errors = {
    "auth/email-already-in-use":
      "This email already has an account. Please log in.",
    "auth/invalid-email":
      "Please enter a valid email address.",
    "auth/weak-password":
      "Your password must contain at least 6 characters.",
    "auth/invalid-credential":
      "Incorrect email or password. Please try again.",
    "auth/user-not-found":
      "No account found. Please sign up first.",
    "auth/wrong-password":
      "Incorrect email or password.",
    "auth/too-many-requests":
      "Too many attempts. Please wait and try again.",
    "auth/network-request-failed":
      "Network error. Please check your internet connection.",
    "permission-denied":
      "Access denied. Please check your Firestore security rules.",
    "unavailable":
      "Chat service is temporarily unavailable. Please try again.",
    "failed-precondition":
      "Firestore is not ready (database not created or index missing). Check the browser console.",
    "not-found":
      "Firestore database not found. Create it in Firebase Console > Firestore Database."
  };

  if (errors[code]) return errors[code];

  if (code === "auth/operation-not-allowed") {
    return "Email/password login is disabled. Enable it in Firebase Authentication.";
  }

  if (code === "auth/unauthorized-domain") {
    return "This website domain is not authorized in Firebase Authentication.";
  }

  if (code === "auth/invalid-api-key") {
    return "Firebase API key is invalid. Check your Firebase configuration.";
  }

  return error?.message || "Something went wrong. Please try again.";
}

function setAuthError(message = "") {
  authError.textContent = message;
}

function setSendError(message = "") {
  sendError.textContent = message;
}

function setAuthLoading(isLoading) {
  authSubmit.disabled = isLoading;
  authSubmitText.textContent = isLoading
    ? "Please wait..."
    : authMode === "signup"
      ? "Create account"
      : "Log in";
}

function getInitial(name) {
  return (name || "U").trim().charAt(0).toUpperCase() || "U";
}

function getColor(name) {
  const colors = [
    "#7055c9", "#a45cae", "#357e98",
    "#b46d52", "#4e8c72", "#7860b0"
  ];

  let hash = 0;
  for (const character of (name || "User")) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return colors[hash % colors.length];
}

function avatarGradient(name) {
  return `linear-gradient(135deg, ${getColor(name)}, #b178ed)`;
}

function getDisplayName(user) {
  return (
    user.displayName ||
    user.email?.split("@")[0] ||
    "User"
  ).slice(0, 40);
}

function formatTime(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "Just now";
  }

  return timestamp.toDate().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function updateProfileUI(user) {
  const name = getDisplayName(user);

  myName.textContent = name;
  myAvatar.textContent = getInitial(name);
  myAvatar.style.background = avatarGradient(name);
}

function showScreen(screen) {
  authScreen.classList.toggle("hidden", screen !== "auth");
  chatScreen.classList.toggle("hidden", screen !== "chat");
}

// Save the user in the "users" collection so others can find and chat with them
async function saveUserProfile(user) {
  try {
    await setDoc(
      doc(db, "users", user.uid),
      {
        uid: user.uid,
        name: getDisplayName(user),
        lastSeen: serverTimestamp()
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Save user error:", error.code, error.message);
  }
}

// Same chat id for both people, no matter who starts the chat
function privateChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

function getMessagesCollection(chat) {
  if (chat.type === "private") {
    return collection(
      db,
      "chats",
      privateChatId(currentUser.uid, chat.uid),
      "messages"
    );
  }
  return collection(db, "messages");
}

// 5. Switch between signup and login
function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";

  signupTab.classList.toggle("active", isSignup);
  loginTab.classList.toggle("active", !isSignup);

  authTitle.textContent = isSignup
    ? "Create your account"
    : "Welcome back!";

  authSubtitle.textContent = isSignup
    ? "Join the conversation. It starts with you."
    : "Log in and catch up with your people.";

  authSubmitText.textContent = isSignup
    ? "Create account"
    : "Log in";

  nameField.classList.toggle("hidden", !isSignup);
  displayNameInput.required = isSignup;
  passwordInput.autocomplete = isSignup
    ? "new-password"
    : "current-password";

  setAuthError("");
}

signupTab.addEventListener("click", () => setAuthMode("signup"));
loginTab.addEventListener("click", () => setAuthMode("login"));

// 6. Signup and login
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (authSubmit.disabled) return;

  setAuthError("");

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const name = displayNameInput.value.trim();

  if (!email || !password) {
    setAuthError("Please enter your email and password.");
    return;
  }

  if (authMode === "signup" && !name) {
    setAuthError("Please enter your name.");
    return;
  }

  if (authMode === "signup" && name.length > 40) {
    setAuthError("Your name must be 40 characters or less.");
    return;
  }

  setAuthLoading(true);

  try {
    if (authMode === "signup") {
      signingUp = true;

      const result = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await updateProfile(result.user, {
        displayName: name
      });

      updateProfileUI(result.user);
      await saveUserProfile(result.user);

      showToast("Account created successfully! Welcome to ChatWave 💜");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Welcome back! 💜");
    }
  } catch (error) {
    setAuthError(friendlyError(error));
  } finally {
    signingUp = false;
    setAuthLoading(false);
  }
});

// 7. Logout
async function logout() {
  if (!currentUser) return;

  try {
    await signOut(auth);
    emojiPicker.classList.add("hidden");
    showToast("You have logged out.");
  } catch (error) {
    showToast(friendlyError(error));
  }
}

$("logoutBtn").addEventListener("click", logout);
$("mobileLogoutBtn").addEventListener("click", logout);

// 8. Authentication state
onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }

  if (unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }

  if (!user) {
    showScreen("auth");
    setAuthMode("signup");
    messagesBox.replaceChildren();
    userListBox.replaceChildren();
    usersCache = [];
    activeChat = GLOBAL_CHAT;
    connectionText.textContent = "Not connected";
    return;
  }

  showScreen("chat");
  updateProfileUI(user);

  // During signup the name is saved after updateProfile(), so skip here.
  if (!signingUp) saveUserProfile(user);

  startUsersListener();
  openChat(GLOBAL_CHAT);
});

// 9. People list (everyone who has an account)
function startUsersListener() {
  unsubscribeUsers = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      usersCache = [];

      snapshot.forEach((userDoc) => {
        const data = userDoc.data();

        if (
          typeof data.uid === "string" &&
          typeof data.name === "string"
        ) {
          usersCache.push({ uid: data.uid, name: data.name });
        }
      });

      usersCache.sort((a, b) => a.name.localeCompare(b.name));
      renderUserList();
    },
    (error) => {
      console.error("Users listener error:", error.code, error.message);
      userListBox.replaceChildren();

      const note = document.createElement("p");
      note.style.cssText = "margin:8px 10px;color:#89859e;font-size:11px;";
      note.textContent = friendlyError(error);
      userListBox.appendChild(note);
      showToast(friendlyError(error));
    }
  );
}

function renderUserList() {
  userListBox.replaceChildren();

  if (!currentUser) {
    renderMobilePicker([]);
    return;
  }

  const others = usersCache.filter((person) => person.uid !== currentUser.uid);
  renderMobilePicker(others);

  if (others.length === 0) {
    const note = document.createElement("p");
    note.style.cssText =
      "margin:8px 10px;color:#89859e;font-size:11px;line-height:1.7;";
    note.textContent = "No other members yet. Ask a friend to sign up!";
    userListBox.appendChild(note);
    return;
  }

  others.forEach((person) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation";
    button.style.width = "100%";
    button.dataset.uid = person.uid;

    if (activeChat.type === "private" && activeChat.uid === person.uid) {
      button.classList.add("active");
    }

    const avatar = document.createElement("div");
    avatar.className = "avatar avatar-purple";
    avatar.textContent = getInitial(person.name);
    avatar.style.background = avatarGradient(person.name);

    const info = document.createElement("div");
    info.className = "conversation-info";

    const name = document.createElement("strong");
    name.textContent = person.name;

    const subtitle = document.createElement("span");
    subtitle.textContent = "Private chat";

    info.append(name, subtitle);
    button.append(avatar, info);

    button.addEventListener("click", () => {
      openChat({ type: "private", uid: person.uid, name: person.name });
    });

    userListBox.appendChild(button);
  });
}

// 10. Open a chat (Global Lounge or a private chat with one person)
function openChat(chat) {
  activeChat = chat;
  const isGlobal = chat.type === "global";

  // Sidebar highlight
  globalChatBtn.classList.toggle("active", isGlobal);
  renderUserList();

  // Header
  headerSub.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "live-dot";

  if (isGlobal) {
    headerAvatar.className = "avatar global-avatar header-avatar";
    headerAvatar.textContent = "✦";
    headerAvatar.style.background = "";
    headerTitle.innerHTML = 'Global Lounge <span class="verified">✓</span>';
    headerSub.append(dot, " Shared space · All members");
    welcomeTitle.textContent = "Welcome to the Lounge!";
    welcomeText.textContent =
      "You're chatting with the community. Be kind, be you. 💜";
    messageInput.placeholder = "Write something lovely...";
  } else {
    headerAvatar.className = "avatar avatar-purple header-avatar";
    headerAvatar.textContent = getInitial(chat.name);
    headerAvatar.style.background = avatarGradient(chat.name);
    headerTitle.textContent = chat.name;
    headerSub.append(dot, " Private chat · Only you two");
    welcomeTitle.textContent = `Chat with ${chat.name}`;
    welcomeText.textContent =
      "This conversation is private between the two of you. 💜";
    messageInput.placeholder = `Message ${chat.name}...`;
  }

  emojiPicker.classList.add("hidden");
  setSendError("");
  startLiveMessages();
}

globalChatBtn.addEventListener("click", () => {
  if (activeChat.type !== "global") openChat(GLOBAL_CHAT);
});

// 11. Listen for messages of the open chat
function startLiveMessages() {
  if (!currentUser) return;

  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }

  const chat = activeChat;
  connectionText.textContent = "Connecting to chat…";

  messagesBox.replaceChildren();

  const loading = document.createElement("div");
  loading.className = "empty-state";
  loading.innerHTML = `
    <div class="empty-icon">✦</div>
    <h3>Loading conversations...</h3>
    <p>Connecting you to the chat.</p>
  `;
  messagesBox.appendChild(loading);

  const messagesQuery = query(
    getMessagesCollection(chat),
    orderBy("createdAt", "asc"),
    limitToLast(100)
  );

  unsubscribeMessages = onSnapshot(
    messagesQuery,
    { includeMetadataChanges: false },
    (snapshot) => {
      connectionText.textContent =
        snapshot.metadata.fromCache
          ? "Offline · Showing cached data"
          : "Connected to live chat";

      messagesBox.replaceChildren();

      if (snapshot.empty) {
        const empty = document.createElement("div");
        empty.className = "empty-state";

        const icon = document.createElement("div");
        icon.className = "empty-icon";
        icon.textContent = "✦";

        const heading = document.createElement("h3");
        const description = document.createElement("p");

        if (chat.type === "private") {
          heading.textContent = "No messages yet";
          description.textContent = `Say hello to ${chat.name}! 👋`;
        } else {
          heading.textContent = "It's a little quiet here...";
          description.textContent = "Be the first to say hello! 👋";
        }

        empty.append(icon, heading, description);
        messagesBox.appendChild(empty);
        return;
      }

      snapshot.forEach((messageDoc) => {
        const data = messageDoc.data();

        // Do not render malformed or unexpected records.
        if (
          typeof data.text !== "string" ||
          typeof data.uid !== "string" ||
          typeof data.name !== "string"
        ) return;

        renderMessage(messageDoc.id, data);
      });

      messagesBox.scrollTop = messagesBox.scrollHeight;
    },
    (error) => {
      console.error("Messages listener error:", error.code, error.message);
      connectionText.textContent = "Connection problem";
      messagesBox.replaceChildren();

      const empty = document.createElement("div");
      empty.className = "empty-state";

      const heading = document.createElement("h3");
      heading.textContent = "Couldn't load the chat";

      const description = document.createElement("p");
      description.textContent = friendlyError(error) + (error.code ? ` [${error.code}]` : "");

      empty.append(heading, description);
      messagesBox.appendChild(empty);
    }
  );
}

// 12. Render messages safely using textContent
function renderMessage(id, data) {
  const mine = data.uid === currentUser?.uid;

  const row = document.createElement("article");
  row.className = `message-row${mine ? " mine" : ""}`;
  row.dataset.messageId = id;

  const avatar = document.createElement("div");
  avatar.className = "avatar avatar-purple message-avatar";
  avatar.textContent = getInitial(data.name);
  avatar.style.background = avatarGradient(data.name);

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const sender = document.createElement("strong");
  sender.textContent = mine ? "You" : data.name.slice(0, 40);

  const time = document.createElement("time");
  time.textContent = formatTime(data.createdAt);

  meta.append(sender, time);

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = data.text;

  body.append(meta, bubble);
  row.append(avatar, body);
  messagesBox.appendChild(row);
}

// 13. Send a message to the open chat
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || sending) return;

  const text = messageInput.value.trim();

  if (!text) {
    messageInput.focus();
    return;
  }

  if (text.length > 2000) {
    setSendError("Messages cannot exceed 2000 characters.");
    return;
  }

  sending = true;
  sendBtn.disabled = true;
  setSendError("");

  try {
    await addDoc(getMessagesCollection(activeChat), {
      text,
      uid: currentUser.uid,
      name: getDisplayName(currentUser),
      createdAt: serverTimestamp()
    });

    messageInput.value = "";
    emojiPicker.classList.add("hidden");
    messageInput.focus();
  } catch (error) {
    console.error("Send message error:", error.code, error.message);
    setSendError(friendlyError(error) + (error.code ? ` [${error.code}]` : ""));
  } finally {
    sending = false;
    sendBtn.disabled = false;
  }
});

// 14. Emoji picker
emojiBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  emojiPicker.classList.toggle("hidden");
});

emojiPicker.addEventListener("click", (event) => {
  const button = event.target.closest("button");

  if (!button) return;

  const emoji = button.textContent;
  const start = messageInput.selectionStart ?? messageInput.value.length;
  const end = messageInput.selectionEnd ?? start;
  const value = messageInput.value;

  const nextValue =
    value.slice(0, start) + emoji + value.slice(end);

  if (nextValue.length > 2000) {
    setSendError("Message limit reached.");
    return;
  }

  messageInput.value = nextValue;
  messageInput.focus();

  const cursor = start + emoji.length;
  messageInput.setSelectionRange(cursor, cursor);
  setSendError("");
});

document.addEventListener("click", (event) => {
  if (
    !emojiPicker.contains(event.target) &&
    !emojiBtn.contains(event.target)
  ) {
    emojiPicker.classList.add("hidden");
  }
});

// Enter sends
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

console.log("ChatWave v2 loaded: private chats enabled.");
