if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/main_program/service-worker.js')
      .then(function (registration) {
        console.log('Service Worker registered:', registration.scope);
        registration.update();
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      })
      .catch(function (error) {
        console.log('Service Worker registration failed:', error);
      });
  });
}

console.log("SheShield app.js loaded successfully");

const LOGIN_TIME_KEY = 'sheshield_login_time';
const AUTO_LOGIN_DAYS = 30;
let emergencyContacts = [];
let profileData = {
  name: '',
  phone: '',
  description: '',
  imageUrl: ''
};

function emptyProfileData() {
  return {
    name: '',
    phone: '',
    description: '',
    imageUrl: ''
  };
}

function clearProfileRuntimeState() {
  profileData = emptyProfileData();
  const profileNameInput = getCachedElement("profileName");
  const profilePhoneInput = getCachedElement("profilePhone");
  const profileDescriptionInput = getCachedElement("profileDescription");
  const profilePreview = getCachedElement("profileAvatarPreview");

  if (profileNameInput) profileNameInput.value = "";
  if (profilePhoneInput) profilePhoneInput.value = "";
  if (profileDescriptionInput) profileDescriptionInput.value = "";
  if (profilePreview) {
    profilePreview.style.backgroundImage = "";
    profilePreview.textContent = "+";
  }

  updateSidebarProfile();
}

let lastKnownLocation = null;
let routeControl = null;
let currentGoogleMapsUrl = null;
let chatLimit = 20;
let chatMessageCursor = null;
let isChatAtBottom = true;
let profileCache = {};
let alarmActive = false;
let alarmContext = null;
let alarmOscillator = null;
let alarmGain = null;
let isAdmin = false;
let unsubscribeChat = null;
let unsubscribeAdminChat = null;
let unsubscribeAdminAlarm = null;

const appDomCache = {};
const DEBUG_MODE = false;

function appLog() {
  if (DEBUG_MODE && typeof console !== 'undefined') {
    console.log.apply(console, arguments);
  }
}

function getCachedElement(id) {
  if (!appDomCache[id]) {
    appDomCache[id] = document.getElementById(id);
  }
  return appDomCache[id];
}

function setTextContent(id, value) {
  const element = getCachedElement(id);
  if (element) {
    element.textContent = value;
  }
}

function setVisible(id, visible) {
  const element = getCachedElement(id);
  if (element) {
    element.style.display = visible ? 'block' : 'none';
  }
}

function cacheStaticUiElements() {
  const idsToCache = [
    "registerBtn",
    "loginBtn",
    "emailInput",
    "passwordInput",
    "rememberMe",
    "authMessage",
    "alarmBtn",
    "sosBtn",
    "sosMessage",
    "contactPermissionBtn",
    "pickContactBtn",
    "profileImageInput",
    "saveProfileBtn",
    "saveContactBtn",
    "contactName",
    "contactPhone",
    "contactMessage",
    "logoutBtn",
    "findPoliceBtn",
    "policeMessage",
    "openGoogleMapsRouteBtn",
    "sendChatBtn",
    "shareLocationBtn",
    "chatMessageInput",
    "chatStatus",
    "reportIncidentBtn",
    "incidentType",
    "incidentDescription",
    "incidentMessage",
    "openMenuBtn",
    "installAppBtn",
    "menuToggle",
    "overlay",
    "sidebar",
    "sidebarProfileCard",
    "profileSection",
    "profileAvatarPreview",
    "profileMessage",
    "chatWindow",
    "chatStatus"
  ];

  idsToCache.forEach(function (id) {
    getCachedElement(id);
  });
}

function showLogin() {
  setVisible("authSection", true);
  setVisible("mainApp", false);
}

function showApp() {
  setVisible("authSection", false);
  setVisible("mainApp", true);
}

function startAlarm() {
  if (alarmActive) return;

  try {
    alarmContext = new (window.AudioContext || window.webkitAudioContext)();
    alarmOscillator = alarmContext.createOscillator();
    alarmGain = alarmContext.createGain();

    alarmOscillator.type = 'sine';
    alarmGain.gain.setValueAtTime(0.25, alarmContext.currentTime);

    alarmOscillator.connect(alarmGain);
    alarmGain.connect(alarmContext.destination);
    alarmOscillator.start();

    // Sweep frequency for a siren effect
    let rising = true;
    const sweepInterval = setInterval(function () {
      if (!alarmActive) {
        clearInterval(sweepInterval);
        return;
      }
      const freq = rising ? 1000 : 600;
      alarmOscillator.frequency.linearRampToValueAtTime(freq, alarmContext.currentTime + 0.5);
      rising = !rising;
    }, 500);

    alarmActive = true;
  } catch (error) {
    console.log('Alarm start error:', error);
  }
}

function stopAlarm() {
  if (!alarmActive) return;

  if (alarmOscillator) {
    alarmOscillator.stop();
    alarmOscillator.disconnect();
    alarmOscillator = null;
  }
  if (alarmGain) {
    alarmGain.disconnect();
    alarmGain = null;
  }
  if (alarmContext) {
    alarmContext.close();
    alarmContext = null;
  }

  alarmActive = false;
}

function isLoginExpired() {
  const lastLogin = localStorage.getItem(LOGIN_TIME_KEY);
  if (!lastLogin) return false;
  return Date.now() - Number(lastLogin) > AUTO_LOGIN_DAYS * 24 * 60 * 60 * 1000;
}

function initApp() {
  cacheStaticUiElements();
  startLocationTracking();
  if (!window.firebase || !firebase.auth) {
    alert("Firebase is not loaded. Please check your internet connection and try again.");
    return;
  }

  const registerBtn = getCachedElement("registerBtn");
  if (registerBtn) {
    registerBtn.addEventListener("click", function () {
      const email = getCachedElement("emailInput").value;
      const password = getCachedElement("passwordInput").value;

      auth.createUserWithEmailAndPassword(email, password)
        .then(function (userCredential) {
          const authMessage = getCachedElement("authMessage");
          if (authMessage) {
            authMessage.textContent = "✅ Registered successfully! You can now log in.";
          }
          console.log("User registered:", userCredential.user.email);
        })
        .catch(function (error) {
          const authMessage = getCachedElement("authMessage");
          if (authMessage) {
            authMessage.textContent = "⚠️ " + error.message;
          }
          console.log("Register error:", error.message);
        });
    });
  }

  const loginBtn = getCachedElement("loginBtn");
  if (loginBtn) {
    loginBtn.addEventListener("click", function () {
      const email = getCachedElement("emailInput").value;
      const password = getCachedElement("passwordInput").value;
      const rememberMe = getCachedElement("rememberMe").checked;
      const persistence = rememberMe ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;

      auth.setPersistence(persistence)
        .then(function () {
          return auth.signInWithEmailAndPassword(email, password);
        })
        .then(function (userCredential) {
          if (rememberMe) {
            localStorage.setItem(LOGIN_TIME_KEY, Date.now().toString());
          } else {
            localStorage.removeItem(LOGIN_TIME_KEY);
          }

          const authMessage = getCachedElement("authMessage");
          if (authMessage) {
            authMessage.textContent = "✅ Logged in as " + userCredential.user.email;
          }
          console.log("User logged in:", userCredential.user.email);

          showApp();
          loadIncidents();
          loadEmergencyContact();
          listenToChatMessages();
          checkAdminStatus();
          
        })
        .catch(function (error) {
          const authMessage = getCachedElement("authMessage");
          if (authMessage) {
            authMessage.textContent = "⚠️ " + error.message;
          }
          console.log("Login error:", error.message);
        });
    });
  }

  const alarmBtn = getCachedElement("alarmBtn");
  if (alarmBtn) {
    alarmBtn.addEventListener("click", function () {
      if (alarmActive) {
        stopAlarm();
        alarmBtn.textContent = "🔊 Alarm";
      } else {
        startAlarm();
        logAlarmTrigger(); 
        alarmBtn.textContent = "🔇 Stop Alarm";
      }
    });
  }

  const sosBtn = getCachedElement("sosBtn");
  if (sosBtn) {
    sosBtn.addEventListener("click", async function () {
      await handleHomeSosButtonPress();
    });
  }

  const contactPermissionBtn = getCachedElement("contactPermissionBtn");
  if (contactPermissionBtn) {
    contactPermissionBtn.addEventListener("click", function () {
      pickContactFromPhone();
    });
  }

  const pickContactBtn = getCachedElement("pickContactBtn");
  if (pickContactBtn) {
    pickContactBtn.addEventListener("click", function () {
      pickContactFromPhone();
    });
  }

  const editProfileImageBtn = getCachedElement("editProfileImageBtn");
  if (editProfileImageBtn) {
    editProfileImageBtn.addEventListener("click", function () {
      const profileImageInput = getCachedElement("profileImageInput");
      if (profileImageInput) {
        profileImageInput.click();
      }
    });
  }

  const profileAvatarPreview = getCachedElement("profileAvatarPreview");
  if (profileAvatarPreview) {
    profileAvatarPreview.addEventListener("click", function () {
      const profileImageInput = getCachedElement("profileImageInput");
      if (profileImageInput) {
        profileImageInput.click();
      }
    });
  }

  const profileImageInput = getCachedElement("profileImageInput");
  if (profileImageInput) {
    profileImageInput.addEventListener("change", handleProfileImageUpload);
  }

  const saveProfileBtn = getCachedElement("saveProfileBtn");
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", saveUserProfile);
  }

  const saveContactBtn = getCachedElement("saveContactBtn");
  if (saveContactBtn) {
    saveContactBtn.addEventListener("click", function () {
      const contactName = getCachedElement("contactName").value.trim();
      const contactPhone = getCachedElement("contactPhone").value.trim();
      const contactMessage = getCachedElement("contactMessage");
      const user = auth.currentUser;

      if (!user) {
        if (contactMessage) {
          contactMessage.textContent = "⚠️ You must be logged in to save a contact.";
        }
        return;
      }

      if (!contactPhone) {
        if (contactMessage) {
          contactMessage.textContent = "⚠️ Please enter a WhatsApp number.";
        }
        return;
      }

      const cleanPhone = contactPhone.replace(/[^\d+]/g, "");
      const newContact = {
        id: Date.now().toString(),
        name: contactName || "Emergency Contact",
        phone: cleanPhone
      };

      emergencyContacts.push(newContact);

      db.collection("users").doc(user.uid).set({
        emergencyContacts: emergencyContacts
      }, { merge: true })
        .then(function () {
          if (contactMessage) {
            contactMessage.textContent = "✅ Emergency contact saved.";
          }
          getCachedElement("contactName").value = "";
          getCachedElement("contactPhone").value = "";
          renderContactList();
          console.log("Emergency contact saved", newContact);
        })
        .catch(function (error) {
          if (contactMessage) {
            contactMessage.textContent = "⚠️ " + error.message;
          }
          console.log("Contact save error:", error.message);
        });
    });
  }

  const logoutBtn = getCachedElement("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      auth.signOut().then(function () {
        localStorage.removeItem(LOGIN_TIME_KEY);
        emergencyContacts = [];
        profileData = emptyProfileData();
        getCachedElement("emailInput").value = "";
        getCachedElement("passwordInput").value = "";
        const authMessage = getCachedElement("authMessage");
        if (authMessage) {
          authMessage.textContent = "Logged out.";
        }
        if (chatUnsubscribe) {
          chatUnsubscribe();
          chatUnsubscribe = null;
        }
        renderProfileFields();
        updateSidebarProfile();
        stopAlarm();
        showLogin();
        console.log("User logged out");
      });
    });
  }

  document.getElementById("findPoliceBtn").addEventListener("click", function () {
    if (!auth.currentUser) {
      document.getElementById("policeMessage").textContent = "⚠️ Please login first.";
      return;
    }

    if (lastKnownLocation) {
      searchNearbyPolice(lastKnownLocation.lat, lastKnownLocation.lng);
    } else {
      getLocation(function (location) {
        searchNearbyPolice(location.lat, location.lng);
      });
    }
  });

  document.getElementById("openGoogleMapsRouteBtn").addEventListener("click", function () {
    if (currentGoogleMapsUrl) {
      window.open(currentGoogleMapsUrl, "_blank", "noopener,noreferrer");
    } else {
      document.getElementById("policeMessage").textContent = "⚠️ Search for nearby police stations first to get Google Maps directions.";
    }
  });

  document.getElementById("sendChatBtn").addEventListener("click", function () {
    sendChatMessage();
  });

  const loadOlderMessagesBtn = document.getElementById("loadOlderMessagesBtn");
  if (loadOlderMessagesBtn) {
    loadOlderMessagesBtn.addEventListener("click", function () {
      loadOlderChatMessages();
    });
  }

  const chatWindow = document.getElementById("chatWindow");
  if (chatWindow) {
    chatWindow.addEventListener("scroll", function () {
      const atBottom = chatWindow.scrollHeight - chatWindow.scrollTop <= chatWindow.clientHeight + 16;
      isChatAtBottom = atBottom;
    });
  }

  document.getElementById("shareLocationBtn").addEventListener("click", function () {
    const chatInput = document.getElementById("chatMessageInput");
    if (lastKnownLocation) {
      chatInput.value = chatInput.value.trim() + (chatInput.value.trim() ? " " : "") +
        "My current location: https://www.google.com/maps?q=" + lastKnownLocation.lat + "," + lastKnownLocation.lng;
    } else {
      document.getElementById("chatStatus").textContent = "⚠️ Please get your location first by pressing SOS.";
    }
  });

  document.getElementById("chatMessageInput").addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });

  document.getElementById("reportIncidentBtn").addEventListener("click", function () {
    const type = document.getElementById("incidentType").value;
    const description = document.getElementById("incidentDescription").value;

    const user = auth.currentUser;
    if (!user) {
      document.getElementById("incidentMessage").textContent = "⚠️ You must be logged in.";
      return;
    }

    if (!type || !description) {
      document.getElementById("incidentMessage").textContent = "⚠️ Please fill in both fields.";
      return;
    }

    const now = new Date();

    db.collection("users").doc(user.uid).collection("incidents").add({
      type: type,
      description: description,
      dateTime: now.toString(),
      createdAt: now
    })
    .then(function () {
      document.getElementById("incidentMessage").textContent = "✅ Incident reported.";
      document.getElementById("incidentType").value = "";
      document.getElementById("incidentDescription").value = "";
      console.log("Incident saved");
      loadIncidents();
    })
    .catch(function (error) {
      document.getElementById("incidentMessage").textContent = "⚠️ " + error.message;
      console.log("Incident save error:", error.message);
    });
  });

  document.getElementById("openMenuBtn").addEventListener("click", function () {
    showSidebar();
  });

  document.getElementById("installAppBtn").addEventListener("click", function () {
    handleInstallClick();
    hideSidebar();
  });

  document.getElementById("menuToggle").addEventListener("click", function () {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("overlay").classList.toggle("show");
  });

  document.getElementById("overlay").addEventListener("click", function () {
    hideSidebar();
  });

  document.querySelectorAll(".sidebarItem[data-section]").forEach(function (item) {
    item.addEventListener("click", function () {
      document.querySelectorAll(".pageSection").forEach(function (section) {
        section.style.display = "none";
      });
      document.getElementById(item.dataset.section).style.display = "block";

      document.querySelectorAll(".sidebarItem").forEach(function (el) {
        el.classList.remove("active");
      });
      item.classList.add("active");

      hideSidebar();
    });
  });

  const profileCard = document.getElementById("sidebarProfileCard");
  if (profileCard) {
    profileCard.addEventListener("click", function () {
      document.querySelectorAll(".pageSection").forEach(function (section) {
        section.style.display = "none";
      });
      document.getElementById("profileSection").style.display = "block";

      document.querySelectorAll(".sidebarItem").forEach(function (el) {
        el.classList.remove("active");
      });
      const profileMenuItem = document.querySelector(".sidebarItem[data-section='profileSection']");
      if (profileMenuItem) {
        profileMenuItem.classList.add("active");
      }
      hideSidebar();
    });
  }

  const statusElement = getCachedElement("status");
  if (statusElement) {
    statusElement.textContent = "Your Safety Our Priority";
  }

  const closePublicProfileModalButton = document.getElementById("closePublicProfileModal");
  const publicProfileModal = document.getElementById("publicProfileModal");
  const closePublicProfileImageModalButton = document.getElementById("closePublicProfileImageModal");
  const publicProfileImageModal = document.getElementById("publicProfileImageModal");
  const publicProfileAvatar = document.getElementById("publicProfileAvatar");

  if (closePublicProfileModalButton) {
    closePublicProfileModalButton.addEventListener("click", function () {
      if (publicProfileModal) {
        publicProfileModal.style.display = "none";
      }
    });
  }

  if (closePublicProfileImageModalButton) {
    closePublicProfileImageModalButton.addEventListener("click", function () {
      if (publicProfileImageModal) {
        publicProfileImageModal.style.display = "none";
      }
    });
  }

  if (publicProfileImageModal) {
    publicProfileImageModal.addEventListener("click", function (event) {
      if (event.target === publicProfileImageModal) {
        publicProfileImageModal.style.display = "none";
      }
    });
  }

  if (publicProfileModal) {
    publicProfileModal.addEventListener("click", function (event) {
      if (event.target === publicProfileModal) {
        publicProfileModal.style.display = "none";
      }
    });
  }

  if (publicProfileAvatar) {
    publicProfileAvatar.addEventListener("click", function () {
      const publicProfileImage = publicProfileAvatar.style.backgroundImage;
      const imageUrlMatch = publicProfileImage && publicProfileImage.match(/url\(["']?(.+?)["']?\)/);

      if (imageUrlMatch && imageUrlMatch[1]) {
        const image = document.getElementById("largePublicProfileImage");
        if (image) {
          image.src = imageUrlMatch[1];
        }
        if (publicProfileImageModal) {
          publicProfileImageModal.style.display = "flex";
        }
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (publicProfileImageModal && publicProfileImageModal.style.display !== "none") {
        publicProfileImageModal.style.display = "none";
      }
      if (publicProfileModal && publicProfileModal.style.display !== "none") {
        publicProfileModal.style.display = "none";
      }
    }
  });

  auth.onAuthStateChanged(function (user) {
    if (user) {
      if (isLoginExpired()) {
        auth.signOut().then(function () {
          localStorage.removeItem(LOGIN_TIME_KEY);
          showLogin();
        });
        return;
      }

      showApp();
      loadIncidents();
      loadEmergencyContact();
      listenToChatMessages();
      checkAdminStatus();
    } else {
      showLogin();
    }
  });
}

document.addEventListener("DOMContentLoaded", initApp);

function showInstallInstructions() {
  const messageEl = document.getElementById("sosMessage");
  if (!messageEl) return;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);

  if (isIOS) {
    messageEl.textContent = "📲 On iPhone or iPad, tap Share → Add to Home Screen to install SheShield.";
  } else if (isAndroid) {
    messageEl.textContent = "📲 On Android, open the browser menu and choose Install app or Add to Home screen.";
  } else {
    messageEl.textContent = "📲 Use your browser's install option to add SheShield to your home screen.";
  }
}

function handleInstallClick() {
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    document.getElementById("sosMessage").textContent = "✅ SheShield is already installed.";
    return;
  }

  if (window.deferredPrompt) {
    window.deferredPrompt.prompt();
    window.deferredPrompt.userChoice.then(function (choiceResult) {
      if (choiceResult.outcome === "accepted") {
        document.getElementById("sosMessage").textContent = "✅ Install prompt accepted.";
      } else {
        showInstallInstructions();
      }
      window.deferredPrompt = null;
    });
  } else {
    showInstallInstructions();
  }
}

window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault();
  window.deferredPrompt = event;
  console.log("Install prompt ready");
});

window.addEventListener("appinstalled", function () {
  window.deferredPrompt = null;
  document.getElementById("sosMessage").textContent = "✅ SheShield was installed successfully.";
  console.log("App installed");
});

async function handleHomeSosButtonPress() {
  const sosMessage = getCachedElement("sosMessage");

  if (!auth.currentUser) {
    if (sosMessage) {
      sosMessage.textContent = "⚠️ Please login first.";
    }
    return null;
  }

  if (sosMessage) {
    sosMessage.textContent = "🚨 Fetching your current location...";
  }

  let location = lastKnownLocation;
  if (!location) {
    try {
      location = await getLocationAsync();
    } catch (error) {
      if (sosMessage) {
        sosMessage.textContent = "⚠️ Could not get your current location.";
      }
      return null;
    }
  } else {
    showOnMap(location.lat, location.lng);
  }

  if (!location) {
    if (sosMessage) {
      sosMessage.textContent = "⚠️ Location not available.";
    }
    return null;
  }

  if (sosMessage) {
    sosMessage.textContent = "📍 Current location displayed on the map.";
  }

  const shareSos = confirm(
    "Do you want to share an SOS message to a saved emergency contact?\n" +
    "Press OK to share, or Cancel to just show your location on the map."
  );

  if (!shareSos) {
    if (sosMessage) {
      sosMessage.textContent = "📍 Just showing your location on the map.";
    }
    return location;
  }

  if (emergencyContacts.length === 0) {
    if (sosMessage) {
      sosMessage.textContent = "⚠️ No saved emergency contacts. Save one before sharing SOS.";
    }
    return location;
  }

  let selectedContact = emergencyContacts[0];
  if (emergencyContacts.length > 1) {
    const contactList = emergencyContacts.map(function (contact, index) {
      return (index + 1) + ". " + contact.name + " " + contact.phone;
    }).join("\n");

    const choice = prompt(
      "Choose a contact to share SOS:\n" + contactList + "\n" +
      "Enter the contact number, or Cancel to stop."
    );

    if (choice === null) {
      if (sosMessage) {
        sosMessage.textContent = "📍 SOS share cancelled. Your location is shown on the map.";
      }
      return location;
    }

    const indexChoice = parseInt(choice, 10) - 1;
    if (!isNaN(indexChoice) && indexChoice >= 0 && indexChoice < emergencyContacts.length) {
      selectedContact = emergencyContacts[indexChoice];
    } else {
      if (sosMessage) {
        sosMessage.textContent = "⚠️ Invalid contact selected. Showing location only.";
      }
      return location;
    }
  }

  await shareSOSMessage(selectedContact);
  return location;
}

async function triggerHomeSosFlow() {
  const sosMessage = getCachedElement("sosMessage");

  if (!auth.currentUser) {
    if (sosMessage) {
      sosMessage.textContent = "⚠️ Please login first.";
    }
    return null;
  }

  if (sosMessage) {
    sosMessage.textContent = "🚨 Fetching your current location...";
  }
  console.log("SOS button clicked");

  if (lastKnownLocation) {
    if (sosMessage) {
      sosMessage.textContent = "📍 Current location displayed on the map.";
    }
    showOnMap(lastKnownLocation.lat, lastKnownLocation.lng);
    return lastKnownLocation;
  }

  try {
    const location = await getLocationAsync();
    if (sosMessage) {
      sosMessage.textContent = "📍 Current location displayed on the map.";
    }
    return location;
  } catch (error) {
    if (sosMessage) {
      sosMessage.textContent = "⚠️ Could not get your current location.";
    }
    return null;
  }
}

function showSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  if (sidebar) {
    sidebar.classList.add("open");
  }
  if (overlay) {
    overlay.classList.add("show");
  }
}

function hideSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  if (sidebar) {
    sidebar.classList.remove("open");
  }
  if (overlay) {
    overlay.classList.remove("show");
  }
}

let map;
let marker;

function updateLocationDisplay(message) {
  const locationDisplay = getCachedElement("locationDisplay");
  if (locationDisplay) {
    locationDisplay.textContent = message;
  }
}

function resolveLocation(position, onSuccess, onError) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  lastKnownLocation = { lat, lng };

  updateLocationDisplay("📍 Location: " + lat.toFixed(5) + ", " + lng.toFixed(5));
  appLog("Location fetched:", lat, lng);

  showOnMap(lat, lng);

  if (typeof onSuccess === "function") {
    onSuccess({ lat, lng });
  }
}

function getLocationAsync() {
  return new Promise(function (resolve, reject) {
    if (!navigator.geolocation) {
      const message = "Geolocation is not supported by your browser.";
      updateLocationDisplay(message);
      reject(new Error(message));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) {
        resolveLocation(position, resolve, reject);
      },
      function (error) {
        updateLocationDisplay("⚠️ Could not get location: " + error.message);
        appLog("Geolocation error:", error.message);
        reject(error);
      }
    );
  });
}

function getLocation(callback) {
  if (!navigator.geolocation) {
    updateLocationDisplay("Geolocation is not supported by your browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function (position) {
      resolveLocation(position, callback);
    },
    function (error) {
      updateLocationDisplay("⚠️ Could not get location: " + error.message);
      appLog("Geolocation error:", error.message);
    }
  );
}

function showOnMap(lat, lng) {
  if (!map) {
    map = L.map('map').setView([lat, lng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    marker = L.marker([lat, lng]).addTo(map)
      .bindPopup("You are here")
      .openPopup();
  } else {
    map.setView([lat, lng], 15);
    marker.setLatLng([lat, lng]);
  }
}

async function pickContactFromPhone() {
  const contactMessage = document.getElementById("contactMessage");

  if (!auth.currentUser) {
    contactMessage.textContent = "⚠️ Login first to use contact access.";
    return;
  }

  if (navigator.contacts && navigator.contacts.select) {
    try {
      const [pickedContact] = await navigator.contacts.select(["name", "tel"], { multiple: false });

      if (pickedContact && pickedContact.tel && pickedContact.tel.length > 0) {
        const contactName = pickedContact.name ? pickedContact.name[0] : "Emergency Contact";
        const contactPhone = pickedContact.tel[0].replace(/[^\d+]/g, "");

        document.getElementById("contactName").value = contactName;
        document.getElementById("contactPhone").value = contactPhone;
        contactMessage.textContent = "📱 Contact selected. Save it to use for SOS.";
      } else {
        contactMessage.textContent = "No contact was selected.";
      }
    } catch (error) {
      contactMessage.textContent = "⚠️ Could not access contacts: " + error.message;
    }
  } else {
    contactMessage.textContent = "⚠️ This browser does not support direct contact access. You can still save a WhatsApp number manually.";
  }
}

function loadEmergencyContact() {
  const user = auth.currentUser;
  if (!user) {
    clearProfileRuntimeState();
    return;
  }

  profileData = emptyProfileData();

  db.collection("users").doc(user.uid).get()
    .then(function (doc) {
      if (doc.exists) {
        const data = doc.data();
        emergencyContacts = data.emergencyContacts || [];
        profileData = {
          name: data.profileName || "",
          phone: data.profilePhone || "",
          description: data.profileDescription || "",
          imageUrl: data.profileImageUrl || ""
        };
      } else {
        emergencyContacts = [];
        profileData = emptyProfileData();
      }
      renderContactList();
      renderProfileFields();
      updateSidebarProfile();
    })
    .catch(function (error) {
      console.log("Load emergency contacts error:", error.message);
    });
}

function handleProfileImageUpload(event) {
  const file = event.target.files[0];
  const profileMessage = document.getElementById("profileMessage");
  const preview = document.getElementById("profileAvatarPreview");

  if (!file) return;
  if (!file.type.startsWith("image/")) {
    profileMessage.textContent = "⚠️ Please select a valid image file.";
    return;
  }

  profileMessage.textContent = "⏳ Processing image...";

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effectiveType = connection && connection.effectiveType ? connection.effectiveType : "";
  const isSlowConnection = effectiveType === "2g" || effectiveType === "slow-2g";

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const maxWidth = isSlowConnection ? 640 : 800;
      const maxHeight = 800;
      const quality = isSlowConnection ? 0.6 : 0.85;
      const compressedDataUrl = compressImage(img, maxWidth, maxHeight, quality);

      profileData.imageUrl = compressedDataUrl;
      if (preview) {
        preview.style.backgroundImage = "url('" + compressedDataUrl + "')";
        preview.textContent = "";
      }

      const sizeKB = Math.round((compressedDataUrl.length * 0.75) / 1024);
      profileMessage.textContent = "✅ Image ready (" + sizeKB + "KB). Click Save Profile to confirm.";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function compressImage(img, maxWidth, maxHeight, quality) {
  let width = img.width;
  let height = img.height;

  if (width > height) {
    if (width > maxWidth) {
      height = Math.round(height * (maxWidth / width));
      width = maxWidth;
    }
  } else {
    if (height > maxHeight) {
      width = Math.round(width * (maxHeight / height));
      height = maxHeight;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

function saveUserProfile() {
  const user = auth.currentUser;
  const profileMessage = document.getElementById("profileMessage");
  const nameInput = document.getElementById("profileName");
  const phoneInput = document.getElementById("profilePhone");
  const descriptionInput = document.getElementById("profileDescription");

  if (!user) {
    profileMessage.textContent = "⚠️ Please login to save your profile.";
    return;
  }

  profileData.name = nameInput.value.trim();
  profileData.phone = phoneInput.value.trim();
  profileData.description = descriptionInput.value.trim();

  db.collection("users").doc(user.uid).set({
    profileName: profileData.name,
    profilePhone: profileData.phone,
    profileDescription: profileData.description,
    profileImageUrl: profileData.imageUrl
  }, { merge: true })
    .then(function () {
      profileMessage.textContent = "✅ Profile saved successfully.";
      updateSidebarProfile();
    })
    .catch(function (error) {
      profileMessage.textContent = "⚠️ " + error.message;
      console.log("Profile save error:", error.message);
    });
}

function renderProfileFields() {
  const nameInput = document.getElementById("profileName");
  const phoneInput = document.getElementById("profilePhone");
  const descriptionInput = document.getElementById("profileDescription");
  const preview = document.getElementById("profileAvatarPreview");

  if (nameInput) nameInput.value = profileData.name || "";
  if (phoneInput) phoneInput.value = profileData.phone || "";
  if (descriptionInput) descriptionInput.value = profileData.description || "";

  if (preview) {
    if (profileData.imageUrl) {
      preview.style.backgroundImage = "url('" + profileData.imageUrl + "')";
      preview.textContent = "";
    } else {
      preview.style.backgroundImage = "";
      preview.textContent = "+";
    }
  }
}

function updateSidebarProfile() {
  const sidebarName = document.getElementById("sidebarProfileName");
  const sidebarPhone = document.getElementById("sidebarProfilePhone");
  const sidebarAvatar = document.getElementById("sidebarProfileAvatar");

  if (sidebarName) {
    sidebarName.textContent = profileData.name || "Guest User";
  }
  if (sidebarPhone) {
    sidebarPhone.textContent = profileData.phone || "Add your mobile number";
  }
  if (sidebarAvatar) {
    if (profileData.imageUrl) {
      sidebarAvatar.style.backgroundImage = "url('" + profileData.imageUrl + "')";
      sidebarAvatar.style.backgroundSize = "cover";
      sidebarAvatar.style.backgroundPosition = "center";
      sidebarAvatar.textContent = "";
    } else {
      sidebarAvatar.style.backgroundImage = "";
      sidebarAvatar.textContent = "👤";
    }
  }
}

function renderContactList() {
  const label = document.getElementById("savedContactLabel");
  const contactsList = document.getElementById("contactsList");
  contactsList.innerHTML = "";

  if (emergencyContacts.length === 0) {
    label.textContent = "No contact saved yet.";
    return;
  }

  label.textContent = emergencyContacts.length + " saved contact(s).";

  emergencyContacts.forEach(function (contact) {
    const card = document.createElement("div");
    card.className = "contactCard";

    const info = document.createElement("div");
    info.className = "contactInfo";
    info.innerHTML = "<strong>" + contact.name + "</strong><br>" + contact.phone;

    const actions = document.createElement("div");
    actions.className = "contactActions";

    const shareButton = document.createElement("button");
    shareButton.className = "contactButton";
    shareButton.textContent = "Share SOS";
    shareButton.addEventListener("click", async function () {
      await shareSOSMessage(contact);
    });

    const removeButton = document.createElement("button");
    removeButton.className = "contactRemove";
    removeButton.textContent = "✕";
    removeButton.addEventListener("click", function () {
      removeEmergencyContact(contact.id);
    });

    actions.appendChild(shareButton);
    actions.appendChild(removeButton);
    card.appendChild(info);
    card.appendChild(actions);
    contactsList.appendChild(card);
  });
}

async function shareSOSMessage(contact) {
  const sosMessage = document.getElementById("contactMessage");
  const locationDisplay = document.getElementById("locationDisplay");

  if (!auth.currentUser) {
    sosMessage.textContent = "⚠️ Please login first.";
    return;
  }

  if (!contact || !contact.phone) {
    sosMessage.textContent = "⚠️ Select a valid saved contact to share SOS.";
    return;
  }

  function buildProfileText() {
    let profileText = "";
    if (profileData.name || profileData.phone) {
      profileText += "Profile: " + (profileData.name || "Unknown") + ". ";
    }
    if (profileData.phone) {
      profileText += "Mobile: " + profileData.phone + ". ";
    }
    if (profileData.description) {
      profileText += profileData.description + ". ";
    }
    return profileText;
  }

  async function tryShareWithPhoto(message) {
    if (!navigator.share || !navigator.canShare || !profileData.imageUrl) {
      return false;
    }

    try {
      const response = await fetch(profileData.imageUrl);
      const blob = await response.blob();
      const file = new File([blob], "profile.jpg", { type: blob.type || "image/jpeg" });

      if (!navigator.canShare({ files: [file] })) {
        return false;
      }

      await navigator.share({
        title: "Emergency SOS",
        text: message,
        files: [file]
      });

      sosMessage.textContent = "📲 Share menu opened with your photo and message.";
      return true;
    } catch (error) {
      console.log("Web Share failed, falling back:", error);
      return false;
    }
  }

  async function tryShareTextOnly(message) {
    if (!navigator.share) {
      return false;
    }

    try {
      await navigator.share({
        title: "Emergency SOS",
        text: message
      });

      sosMessage.textContent = "📲 Share menu opened with your SOS message.";
      return true;
    } catch (error) {
      console.log("Text share failed, falling back:", error);
      return false;
    }
  }

  function sendWhatsAppFallback(location) {
    const profileText = buildProfileText();
    const message =
      "Emergency! I need help immediately. " +
      profileText +
      "My current location is: https://www.google.com/maps?q=" + location.lat + "," + location.lng;

    const phone = contact.phone.replace(/[^\d+]/g, "");
    const whatsappWebUrl = "https://wa.me/" + phone + "?text=" + encodeURIComponent(message);
    const whatsappAppUrl = "whatsapp://send?phone=" + phone + "&text=" + encodeURIComponent(message);
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    const userConfirmed = confirm(
      "Open WhatsApp to send your SOS message to " + contact.name + "?"
    );

    if (!userConfirmed) {
      sosMessage.textContent = "⚠️ SOS sharing canceled. Your location is shown on the map.";
      return;
    }

    if (isMobile) {
      const newWindow = window.open(whatsappAppUrl, "_blank", "noopener,noreferrer");
      if (!newWindow) {
        window.location.href = whatsappWebUrl;
      }
      setTimeout(function () {
        const fallbackWindow = window.open(whatsappWebUrl, "_blank", "noopener,noreferrer");
        if (!fallbackWindow) {
          window.location.href = whatsappWebUrl;
        }
      }, 900);
    } else {
      const newWindow = window.open(whatsappWebUrl, "_blank", "noopener,noreferrer");
      if (!newWindow) {
        window.location.href = whatsappWebUrl;
      }
    }

    sosMessage.textContent = "📲 WhatsApp opened with your SOS location message for " + contact.name + ".";
  }

  async function handleLocation(location) {
    const profileText = buildProfileText();
    const message =
      "Emergency! I need help immediately. " +
      profileText +
      "My current location is: https://www.google.com/maps?q=" + location.lat + "," + location.lng;

    let shared = await tryShareWithPhoto(message);
    if (!shared) {
      shared = await tryShareTextOnly(message);
    }
    if (!shared) {
      sendWhatsAppFallback(location);
    }

    if (locationDisplay) {
      locationDisplay.textContent = "📍 Location: " + location.lat.toFixed(5) + ", " + location.lng.toFixed(5);
    }
  }

  if (lastKnownLocation) {
    handleLocation(lastKnownLocation);
  } else {
    sosMessage.textContent = "📍 Getting your live location for SOS sharing...";

    try {
      const location = await triggerHomeSosFlow();
      if (location) {
        handleLocation(location);
      } else {
        sosMessage.textContent = "⚠️ Could not get your location for SOS share.";
      }
    } catch (error) {
      sosMessage.textContent = "⚠️ Could not get your location for SOS share: " + (error.message || error);
    }
  }
}

function removeEmergencyContact(contactId) {
  const contactMessage = document.getElementById("contactMessage");
  const user = auth.currentUser;
  if (!user) {
    contactMessage.textContent = "⚠️ Please login first.";
    return;
  }

  emergencyContacts = emergencyContacts.filter(function (contact) {
    return contact.id !== contactId;
  });

  db.collection("users").doc(user.uid).set({
    emergencyContacts: emergencyContacts
  }, { merge: true })
    .then(function () {
      contactMessage.textContent = "✅ Contact removed.";
      renderContactList();
    })
    .catch(function (error) {
      contactMessage.textContent = "⚠️ " + error.message;
      console.log("Remove contact error:", error.message);
    });
}

function openPublicProfileModal(userId, fallbackName, fallbackImage, fallbackDescription) {
  const modal = document.getElementById("publicProfileModal");
  const avatar = document.getElementById("publicProfileAvatar");
  const name = document.getElementById("publicProfileName");
  const description = document.getElementById("publicProfileDescription");

  if (!modal || !avatar || !name || !description) return;

  modal.style.display = "flex";
  avatar.style.backgroundImage = "";
  avatar.textContent = "👤";
  name.textContent = fallbackName || "Guest User";
  description.textContent = fallbackDescription || "No profile description";

  if (fallbackImage) {
    avatar.style.backgroundImage = "url('" + fallbackImage + "')";
    avatar.textContent = "";
  }

  if (!userId) {
    return;
  }

  db.collection("users").doc(userId).get()
    .then(function (doc) {
      if (doc.exists) {
        const data = doc.data();

        name.textContent = data.profileName || fallbackName || "Guest User";
        description.textContent = data.profileDescription || fallbackDescription || "No profile description";

        if (data.profileImageUrl) {
          avatar.style.backgroundImage = "url('" + data.profileImageUrl + "')";
          avatar.textContent = "";
        } else if (fallbackImage) {
          avatar.style.backgroundImage = "url('" + fallbackImage + "')";
          avatar.textContent = "";
        }
      }
    })
    .catch(function (error) {
      console.log("Profile lookup error:", error);
    });
}

function loadOlderChatMessages() {
  const loadOlderMessagesBtn = document.getElementById("loadOlderMessagesBtn");
  const chatWindow = document.getElementById("chatWindow");
  if (!chatWindow || !loadOlderMessagesBtn) return;

  if (!chatMessageCursor) {
    loadOlderMessagesBtn.style.display = "none";
    return;
  }

  loadMessages(false);
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "";
  const time = timestamp instanceof Date ? timestamp : timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const diff = Math.floor((Date.now() - time.getTime()) / 1000);
  if (diff < 60) return diff <= 1 ? "just now" : diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatDateBlock(timestamp) {
  if (!timestamp) return "";
  const date = timestamp instanceof Date ? timestamp : timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) {
    return "Today";
  }
  if (isSameDay(date, yesterday)) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function getCachedProfile(userId) {
  if (!userId) return Promise.resolve(null);
  if (profileCache[userId]) {
    return Promise.resolve(profileCache[userId]);
  }

  return db.collection("users").doc(userId).get()
    .then(function (doc) {
      if (!doc.exists) return null;
      const data = doc.data();
      const profile = {
        name: data.profileName || "Anonymous",
        imageUrl: data.profileImageUrl || "",
        description: data.profileDescription || ""
      };
      profileCache[userId] = profile;
      return profile;
    })
    .catch(function (error) {
      console.log("Profile fetch error:", error);
      return null;
    });
}

function renderChatMessage(doc, previousSenderId, previousTimestamp, prepend) {
  const data = doc.data();
  const chatWindow = document.getElementById("chatWindow");
  if (!chatWindow) return Promise.resolve(previousTimestamp);

  const isOwnMessage = auth.currentUser && data.userId === auth.currentUser.uid;
  const displayName = isOwnMessage ? "You" : (data.userName || "Anonymous");
  const senderId = data.userId || "";
  const isSameSender = previousSenderId && senderId === previousSenderId;
  const messageTime = data.timestamp ? data.timestamp.toDate() : null;
  const oneDay = 24 * 60 * 60 * 1000;
  const needsDateBlock = messageTime && messageTime.getTime() <= Date.now() - oneDay &&
    (!previousTimestamp || !isSameDay(previousTimestamp, messageTime));

  const messageRow = document.createElement("div");
  messageRow.className = "chatMessageRow" + (isOwnMessage ? " ownMessage" : "");

  const dateBlock = needsDateBlock ? document.createElement("div") : null;
  if (needsDateBlock) {
    dateBlock.className = "chatDateBlock";
    dateBlock.textContent = formatDateBlock(messageTime);
  }

  if (!isSameSender) {
    const header = document.createElement("div");
    header.className = "chatMessageHeader";

    const senderInfo = document.createElement("div");
    senderInfo.className = "chatSenderInfo";

    const senderAvatar = document.createElement("img");
    senderAvatar.className = "chatAvatar chatAvatarPlaceholder";
    senderAvatar.alt = "";
    senderAvatar.style.cursor = senderId ? "pointer" : "default";
    senderAvatar.src = "";

    const senderName = document.createElement("strong");
    senderName.textContent = displayName;
    senderName.style.cursor = senderId ? "pointer" : "default";

    senderInfo.appendChild(senderAvatar);
    senderInfo.appendChild(senderName);

    const timestamp = document.createElement("span");
    const timeValue = data.timestamp ? data.timestamp.toDate() : null;
    timestamp.textContent = formatRelativeTime(timeValue);
    if (timeValue) {
      timestamp.title = timeValue.toLocaleString();
    }

    header.appendChild(senderInfo);
    header.appendChild(timestamp);

    if (auth.currentUser && data.userId === auth.currentUser.uid) {
      const deleteButton = document.createElement("button");
      deleteButton.className = "chatDeleteBtn";
      deleteButton.type = "button";
      deleteButton.title = "Delete this message";
      deleteButton.textContent = "✕";
      deleteButton.addEventListener("click", function () {
        deleteChatMessage(doc.id);
      });
      header.appendChild(deleteButton);
    }

    messageRow.appendChild(header);

    if (senderId) {
      getCachedProfile(senderId).then(function (profile) {
        if (profile && profile.imageUrl) {
          senderAvatar.src = profile.imageUrl;
          senderAvatar.classList.remove("chatAvatarPlaceholder");
          senderAvatar.style.display = "inline-block";
        } else {
          senderAvatar.style.display = "none";
        }

        const imageUrl = profile ? profile.imageUrl : "";
        senderAvatar.addEventListener("click", function () {
          if (!senderId) return;
          openPublicProfileModal(senderId, profile ? profile.name : displayName, imageUrl, profile ? profile.description : "");
        });
        senderName.addEventListener("click", function () {
          if (!senderId) return;
          openPublicProfileModal(senderId, profile ? profile.name : displayName, imageUrl, profile ? profile.description : "");
        });
      });
    }

  }

  const messageText = document.createElement("div");
  messageText.className = "chatMessageText";
  messageText.textContent = data.text || "";

  messageRow.appendChild(messageText);

  if (dateBlock) {
    if (prepend && chatWindow.firstChild) {
      chatWindow.insertBefore(dateBlock, chatWindow.firstChild);
    } else {
      chatWindow.appendChild(dateBlock);
    }
  }

  if (prepend && chatWindow.firstChild) {
    chatWindow.insertBefore(messageRow, chatWindow.firstChild);
  } else {
    chatWindow.appendChild(messageRow);
  }

  return Promise.resolve(senderId);
}

function loadMessages(initialLoad) {
  const chatWindow = document.getElementById("chatWindow");
  const loadOlderMessagesBtn = document.getElementById("loadOlderMessagesBtn");
  const chatStatus = document.getElementById("chatStatus");
  if (!chatWindow) return;

  if (initialLoad) {
    chatMessageCursor = null;
    chatWindow.innerHTML = "";
    if (loadOlderMessagesBtn) {
      loadOlderMessagesBtn.style.display = "none";
    }
  }

  let query = db.collection("safetyChat").orderBy("timestamp", "desc").limit(chatLimit + 1);
  if (chatMessageCursor) {
    query = query.startAfter(chatMessageCursor);
  }
if (typeof unsubscribeChat === 'function') {
    unsubscribeChat();
    unsubscribeChat = null;
  }
  unsubscribeChat = query.onSnapshot(function (snapshot) {
    if (snapshot.empty) {
      if (initialLoad && chatStatus) {
        chatStatus.textContent = "No messages yet. Start the conversation.";
      }
      if (loadOlderMessagesBtn) {
        loadOlderMessagesBtn.style.display = "none";
      }
      return;
    }

    // Clear layout view before redrawing live records changes
    chatWindow.innerHTML = "";

    const hasMore = snapshot.docs.length > chatLimit;
    let docs = snapshot.docs.slice(0, chatLimit);
    if (initialLoad) {
      docs = docs.reverse();
    }
    const newCursor = snapshot.docs[hasMore ? chatLimit - 1 : snapshot.docs.length - 1];
    chatMessageCursor = newCursor;

    if (loadOlderMessagesBtn) {
      loadOlderMessagesBtn.style.display = hasMore ? "block" : "none";
    }

    const previousScrollHeight = chatWindow.scrollHeight;
    const previousScrollTop = chatWindow.scrollTop;
    const wasAtBottom = initialLoad || (previousScrollHeight - previousScrollTop - chatWindow.clientHeight <= 16);
    const shouldPrepend = !initialLoad;

    let previousSenderId = null;
    let previousTimestamp = null;

    // Map through documents array sequence cleanly
    const renderPromises = docs.map(function (doc) {
      return renderChatMessage(doc, previousSenderId, previousTimestamp, !initialLoad).then(function (senderId) {
        const data = doc.data();
        previousSenderId = senderId;
        previousTimestamp = data.timestamp ? data.timestamp.toDate() : previousTimestamp;
      });
    });

    Promise.all(renderPromises).then(function () {
      if (chatStatus) {
        chatStatus.textContent = "";
      }
      if (shouldPrepend) {
        const addedHeight = chatWindow.scrollHeight - previousScrollHeight;
        chatWindow.scrollTop = previousScrollTop + addedHeight;
      } else if (wasAtBottom) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
      }
    });
  }, function (error) {
    if (chatStatus) {
      chatStatus.textContent = "⚠️ Could not load chat: " + error.message;
    }
    console.log("Live chat sync error:", error.message);
  });
}


function listenToChatMessages() {
  const chatWindow = document.getElementById("chatWindow");
  if (chatWindow) {
    chatWindow.innerHTML = "<div class='chatSkeleton'>Loading messages…</div>";
  }

  loadMessages(true);
}

function sendChatMessage() {
  const messageInput = document.getElementById("chatMessageInput");
  const chatStatus = document.getElementById("chatStatus");
  const user = auth.currentUser;

  if (!user) {
    if (chatStatus) chatStatus.textContent = "⚠️ Please login to send chat messages.";
    return;
  }

  const text = messageInput.value.trim();
  if (!text) {
    if (chatStatus) chatStatus.textContent = "⚠️ Type a message before sending.";
    return;
  }

  db.collection("safetyChat").add({
    userId: user.uid,
    userName: profileData.name || user.email || "Anonymous",
    text: text,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then(function () {
    messageInput.value = "";
    if (chatStatus) chatStatus.textContent = "✅ Message sent.";
    loadMessages(true);
  })
  .catch(function (error) {
    if (chatStatus) chatStatus.textContent = "⚠️ " + error.message;
    console.log("Chat send error:", error);
  });
}

function deleteChatMessage(messageId) {
  const user = auth.currentUser;
  const chatStatus = document.getElementById("chatStatus");

  if (!user) {
    if (chatStatus) chatStatus.textContent = "⚠️ Please login to delete messages.";
    return;
  }

  db.collection("safetyChat").doc(messageId).get()
    .then(function (doc) {
      if (!doc.exists) {
        throw new Error("Message not found.");
      }
      if (doc.data().userId !== user.uid) {
        throw new Error("You can only delete your own messages.");
      }
      return doc.ref.delete();
    })
    .then(function () {
      if (chatStatus) chatStatus.textContent = "✅ Message deleted.";
      loadMessages(true);
    })
    .catch(function (error) {
      if (chatStatus) chatStatus.textContent = "⚠️ " + error.message;
      console.log("Delete chat error:", error);
    });
}

const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

let policeMarkers = [];
let policeSearchCache = null;

function clearPoliceMarkers() {
  if (policeMarkers.length && map) {
    policeMarkers.forEach(function (marker) {
      map.removeLayer(marker);
    });
  }
  policeMarkers = [];
}

function fetchOverpassData(query) {
  const endpointCalls = OVERPASS_ENDPOINTS.map(function (endpoint) {
    return new Promise(function (resolve, reject) {
      const controller = new AbortController();
      const timeoutId = setTimeout(function () {
        controller.abort();
      }, 7000);

      const url = endpoint + "?data=" + encodeURIComponent(query);

      fetch(url, {
        method: "GET",
        mode: "cors",
        signal: controller.signal,
        headers: {
          "Accept": "application/json"
        }
      })
      .then(function (response) {
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(endpoint + " returned " + response.status + " " + response.statusText);
        }
        return response.json();
      })
      .then(function (json) {
        resolve(json);
      })
      .catch(function (error) {
        clearTimeout(timeoutId);
        console.log("Overpass endpoint failed:", endpoint, error);
        reject(error);
      });
    });
  });

  return Promise.any(endpointCalls)
    .catch(function (error) {
      console.log("All Overpass endpoints failed:", error);
      throw new Error("All Overpass endpoints failed. The public Overpass service may be unavailable right now.");
    });
}

function fetchPoliceStationsFallback(lat, lng) {
  const fallbackUrl = "https://photon.komoot.io/api/?q=police&lat=" + lat + "&lon=" + lng + "&limit=10";

  return fetch(fallbackUrl, {
    method: "GET",
    mode: "cors",
    headers: {
      "Accept": "application/json"
    }
  })
  .then(function (response) {
    if (!response.ok) {
      throw new Error("Fallback police lookup returned " + response.status + " " + response.statusText);
    }
    return response.json();
  })
  .then(function (json) {
    const candidates = Array.isArray(json.features) ? json.features : [];
    if (!candidates.length) {
      throw new Error("No nearby police station results found.");
    }

    const elements = candidates.map(function (feature) {
      const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : [lng, lat];
      const lon = coordinates[0];
      const policeLat = coordinates[1];
      const name = (feature.properties && (feature.properties.name || feature.properties.label)) || "Police Station";

      return {
        lat: policeLat,
        lon: lon,
        tags: {
          name: name
        }
      };
    }).filter(function (element) {
      return typeof element.lat === "number" && typeof element.lon === "number";
    });

    if (!elements.length) {
      throw new Error("No valid police station coordinates found.");
    }

    return { elements: elements };
  });
}

function searchNearbyPolice(lat, lng) {
  const now = Date.now();
  if (policeSearchCache && (now - policeSearchCache.timestamp < 5 * 60 * 1000) && Math.abs(policeSearchCache.lat - lat) < 0.002 && Math.abs(policeSearchCache.lng - lng) < 0.002) {
    document.getElementById("policeMessage").textContent = "📍 Using cached police station list.";
    renderPoliceStations(policeSearchCache.data, lat, lng);
    return;
  }

  currentGoogleMapsUrl = null;
  const openGoogleMapsRouteBtn = document.getElementById("openGoogleMapsRouteBtn");
  if (openGoogleMapsRouteBtn) {
    openGoogleMapsRouteBtn.style.display = "none";
  }

  document.getElementById("policeMessage").textContent = "🔎 Searching nearby police stations...";

  if (!map) {
    showOnMap(lat, lng);
  }

  const query = `
      [out:json];
      node["amenity"="police"](around:12000,${lat},${lng});
      out;
    `;

  fetchOverpassData(query)
    .catch(function () {
      console.log("Overpass unavailable, using fallback police lookup.");
      return fetchPoliceStationsFallback(lat, lng);
    })
    .then(function (data) {
      policeSearchCache = {
        data: data,
        lat: lat,
        lng: lng,
        timestamp: Date.now()
      };

      renderPoliceStations(data, lat, lng);
    })
    .catch(function (error) {
      document.getElementById("policeMessage").textContent =
        "⚠️ Unable to find nearby police stations right now. Try again in a moment.";
      console.log("Police lookup error:", error);
    });
}

function renderPoliceStations(data, lat, lng) {
  if (!data.elements || data.elements.length === 0) {
    document.getElementById("policeMessage").textContent =
      "⚠️ No police station found within 12km.";
    return;
  }

  clearPoliceMarkers();
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestStation = null;
  const bounds = [];

  data.elements.forEach(function (element) {
    const policeLat = element.lat;
    const policeLng = element.lon;
    const stationName = element.tags && element.tags.name ? element.tags.name : "Police Station";

    const marker = L.marker([policeLat, policeLng]).addTo(map)
      .bindPopup(stationName)
      .on('click', function () {
        if (routeControl) {
          map.removeControl(routeControl);
        }
        routeControl = L.Routing.control({
          waypoints: [
            L.latLng(lat, lng),
            L.latLng(policeLat, policeLng)
          ],
          routeWhileDragging: false
        }).addTo(map);

        const openGoogle = window.confirm('Open directions to "' + stationName + '" in Google Maps?');
        if (openGoogle) {
          window.open('https://www.google.com/maps/dir/?api=1&destination=' + policeLat + ',' + policeLng, '_blank');
        }
      });
    policeMarkers.push(marker);
    bounds.push([policeLat, policeLng]);

    const distance = map.distance([lat, lng], [policeLat, policeLng]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestStation = { lat: policeLat, lng: policeLng, name: stationName };
    }
  });

  bounds.push([lat, lng]);
  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }

  if (nearestStation) {
    currentGoogleMapsUrl =
      'https://www.google.com/maps/dir/?api=1&origin=' +
      encodeURIComponent(lat + ',' + lng) +
      '&destination=' +
      encodeURIComponent(nearestStation.lat + ',' + nearestStation.lng) +
      '&travelmode=driving';

    const openGoogleMapsRouteBtn = document.getElementById("openGoogleMapsRouteBtn");
    if (openGoogleMapsRouteBtn) {
      openGoogleMapsRouteBtn.style.display = "inline-flex";
    }

    document.getElementById("policeMessage").textContent =
      "📍 Found " + data.elements.length + " stations. Nearest: " + nearestStation.name + ".";

    if (routeControl) {
      map.removeControl(routeControl);
    }

    routeControl = L.Routing.control({
      waypoints: [
        L.latLng(lat, lng),
        L.latLng(nearestStation.lat, nearestStation.lng)
      ],
      routeWhileDragging: false
    }).addTo(map);
  }
}

function deleteIncident(incidentId) {
  const user = auth.currentUser;
  const incidentMessage = document.getElementById("incidentMessage");
  if (!user) {
    incidentMessage.textContent = "⚠️ Please login first.";
    return;
  }

  db.collection("users").doc(user.uid).collection("incidents").doc(incidentId).delete()
    .then(function () {
      incidentMessage.textContent = "✅ Incident removed.";
      loadIncidents();
    })
    .catch(function (error) {
      incidentMessage.textContent = "⚠️ " + error.message;
      console.log("Delete incident error:", error.message);
    });
}

function loadIncidents() {
  const user = auth.currentUser;
  if (!user) return;

  const listDiv = document.getElementById("incidentList");
  listDiv.innerHTML = "Loading...";

  db.collection("users").doc(user.uid).collection("incidents")
    .orderBy("createdAt", "desc")
    .get()
    .then(function (querySnapshot) {
      listDiv.innerHTML = "";

      if (querySnapshot.empty) {
        listDiv.innerHTML = "<p>No reports yet.</p>";
        return;
      }

      querySnapshot.forEach(function (doc) {
        const data = doc.data();
        const card = document.createElement("div");
        card.className = "incidentCard";
        card.innerHTML =
          "<strong>" + data.type + "</strong><br>" +
          data.description + "<br>" +
          "<small>" + data.dateTime + "</small>";

        const removeIncidentButton = document.createElement("button");
        removeIncidentButton.className = "incidentRemove";
        removeIncidentButton.textContent = "✕";
        removeIncidentButton.addEventListener("click", function () {
          deleteIncident(doc.id);
        });

        card.appendChild(removeIncidentButton);
        listDiv.appendChild(card);
      });
    })
    .catch(function (error) {
      listDiv.innerHTML = "⚠️ Error loading reports: " + error.message;
      console.log("Load incidents error:", error.message);
    });
}

function checkAdminStatus() {
  const user = auth.currentUser;
  if (!user) {
    isAdmin = false;
    updateAdminUI();
    return;
  }
  db.collection("users").doc(user.uid).get().then(function (doc) {
    isAdmin = doc.exists && doc.data().isAdmin === true;
    updateAdminUI();
    if (isAdmin) {
      loadAdminChatModeration();
      loadAdminAlarmHistory();
    }
  });
}

function updateAdminUI() {
  const adminSidebarItem = document.getElementById("adminSidebarItem");
  if (adminSidebarItem) {
    adminSidebarItem.style.display = isAdmin ? "block" : "none";
  }
}

function logAlarmTrigger() {
  const user = auth.currentUser;
  if (!user) return;

  db.collection("alarmTriggers").add({
    userId: user.uid,
    userName: profileData.name || user.email || "Unknown",
    userPhone: profileData.phone || "Not provided",
    location: lastKnownLocation || null,
    triggeredAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function loadAdminChatModeration() {
  const listEl = document.getElementById("adminChatList");
  if (!listEl || !isAdmin) return;
if (typeof unsubscribeAdminChat === 'function') {
    unsubscribeAdminChat();
  }
  unsubscribeAdminChat = db.collection("safetyChat").orderBy("timestamp", "desc").limit(50)
    .onSnapshot(function (snapshot) {
      listEl.innerHTML = "";
      snapshot.forEach(function (doc) {
        const data = doc.data();
        const row = document.createElement("div");
        row.className = "chatMessageRow";
        row.innerHTML =
          "<strong>" + (data.userName || "Anonymous") + "</strong><br>" +
          (data.text || "");

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "chatDeleteBtn";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", function () {
          // Deleting here will now automatically trigger a real-time redraw
          doc.ref.delete(); 
        });

        row.appendChild(deleteBtn);
        listEl.appendChild(row);
      });
    }, function (error) {
      console.log("Admin chat listener error:", error.message);
    });
}


function loadAdminAlarmHistory() {
  const listEl = document.getElementById("adminAlarmList");
  if (!listEl || !isAdmin) return;

if (typeof unsubscribeAdminAlarm === 'function') {
    unsubscribeAdminAlarm();
  }

  unsubscribeAdminAlarm = db.collection("alarmTriggers").orderBy("triggeredAt", "desc").limit(50)
    .onSnapshot(function (snapshot) {
      listEl.innerHTML = "";
      if (snapshot.empty) {
        listEl.innerHTML = "<p>No alarm triggers yet.</p>";
        return;
      }
      snapshot.forEach(function (doc) {
        const data = doc.data();
        const row = document.createElement("div");
        row.className = "incidentCard";
        
        let cardContent = 
          "<strong>" + data.userName + "</strong><br>" +
          "📞 " + data.userPhone + "<br>" +
          "<small>" + (data.triggeredAt ? data.triggeredAt.toDate().toLocaleString() : "") + "</small>";

        if (data.location && data.location.lat && data.location.lng) {
          const mapsUrl = "https://www.google.com/maps?q=" + data.location.lat + "," + data.location.lng;
          cardContent += "<br><a href='" + mapsUrl + "' target='_blank' rel='noopener noreferrer' style='display:inline-block; margin-top:8px; padding:6px 12px; background-color:#e74c3c; color:white; text-decoration:none; border-radius:4px; font-size:13px; font-weight:bold;'>📍 View Pinned Location</a>";
        } else {
          cardContent += "<br><span style='color:#888; font-size:12px;'>📍 No location pin recorded</span>";
        }

        row.innerHTML = cardContent;

        // CREATE THE DELETE BUTTON
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "chatDeleteBtn"; // Reuses your existing cross button styling
        deleteBtn.style.position = "absolute";
        deleteBtn.style.top = "8px";
        deleteBtn.style.right = "8px";
        deleteBtn.textContent = "✕";
        deleteBtn.addEventListener("click", function () {
          deleteAlarmTrigger(doc.id);
        });

        // Ensure the card container can house the absolute positioned button
        row.style.position = "relative";
        row.appendChild(deleteBtn);
        
        listEl.appendChild(row);
      });
    }, function (error) {
      console.log("Alarm history sync error:", error.message);
    });
}

function deleteAlarmTrigger(triggerId) {
  if (!isAdmin) return;
  
  if (confirm("Are you sure you want to delete this alarm log history record permanently?")) {
    db.collection("alarmTriggers").doc(triggerId).delete()
      .then(function () {
        console.log("Alarm log record dropped successfully.");
      })
      .catch(function (error) {
        console.log("Error clearing alarm log record:", error.message);
      });
  }
}

function startLocationTracking() {
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      function (position) {
        lastKnownLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        console.log("Location pinned successfully:", lastKnownLocation.lat, lastKnownLocation.lng);
      },
      function (error) {
        console.log("Location tracking error:", error.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  } else {
    console.log("Geolocation is not supported by this browser.");
  }
}


 