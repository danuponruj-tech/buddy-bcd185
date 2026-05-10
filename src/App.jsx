import React, { useState, useEffect } from 'react';
import { Heart, Send, Trophy, LogOut, MessageCircle, Star, Bell, Image as ImageIcon, X, Eye, EyeOff } from 'lucide-react';
import { auth, db } from './firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  addDoc,
  updateDoc,
  deleteDoc,
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  writeBatch,
  getDocs
} from 'firebase/firestore';

const ADMIN_EMAIL = 'danupona@scg.com';
const DEFAULT_REVEAL_TIME = '2026-06-12T08:00:00';

export default function BuddyApp() {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('login');
  const [formData, setFormData] = useState({ name: '', email: '', password: '', avatar: null });
  const [users, setUsers] = useState([]);
  const [buddyAssignments, setBuddyAssignments] = useState({});
  const [requests, setRequests] = useState([]);
  const [cares, setCares] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [boardRevealTime, setBoardRevealTime] = useState(new Date(DEFAULT_REVEAL_TIME).toISOString());
  const [isBuddyRevealed, setIsBuddyRevealed] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editProfileData, setEditProfileData] = useState({ name: '', avatar: null, avatarPreview: null });
  const [selectedMember, setSelectedMember] = useState(null);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          setUserProfile({ id: user.uid, ...userDoc.data() });
        }
        setPage('dashboard');
      } else {
        setCurrentUser(null);
        setUserProfile(null);
        setPage('login');
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Real-time listeners
  useEffect(() => {
    if (!currentUser) return;

    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsers(data);
      const myProfile = data.find(u => u.id === currentUser.uid);
      if (myProfile) setUserProfile(myProfile);
    });

    const unsubAssignments = onSnapshot(doc(db, 'config', 'buddyAssignments'), (snap) => {
      if (snap.exists()) {
        setBuddyAssignments(snap.data().assignments || {});
      }
    });

    const unsubRevealTime = onSnapshot(doc(db, 'config', 'revealTime'), (snap) => {
      if (snap.exists() && snap.data().time) {
        setBoardRevealTime(snap.data().time);
      }
    });

    const unsubRequests = onSnapshot(collection(db, 'requests'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setRequests(data);
    });

    const unsubCares = onSnapshot(collection(db, 'cares'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setCares(data);
    });

    const unsubNotifs = onSnapshot(
      query(collection(db, 'notifications'), where('toUserId', '==', currentUser.uid)),
      (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setNotifications(data);
      }
    );

    return () => {
      unsubUsers();
      unsubAssignments();
      unsubRevealTime();
      unsubRequests();
      unsubCares();
      unsubNotifs();
    };
  }, [currentUser]);

  // Check buddy reveal time
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      setIsBuddyRevealed(now >= new Date(boardRevealTime).getTime());
    }, 1000);
    return () => clearInterval(timer);
  }, [boardRevealTime]);

  // Format time remaining
  const formatTimeRemaining = (targetTime) => {
    const now = new Date().getTime();
    const target = new Date(targetTime).getTime();
    const diff = Math.max(0, target - now);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `${days} d ${hours} h left`;
  };

  // Resize image and convert to Base64
  const resizeImage = (file, maxSize = 600) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; }
          } else {
            if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          // Return Base64 string with 0.7 quality
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  };

  // Resize avatar to square Base64
  const resizeAvatar = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 150;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  };

  // Convert image to Base64 (returns base64 string directly)
  const uploadImage = async (file, isAvatar = false) => {
    if (!file) return null;
    try {
      return isAvatar ? await resizeAvatar(file) : await resizeImage(file);
    } catch (e) {
      console.error('Image processing error:', e);
      alert('Failed to process image');
      return null;
    }
  };

  // Register
  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      let avatarUrl = null;
      if (formData.avatar) {
        avatarUrl = await uploadImage(formData.avatar, true);
      }
      const cred = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: formData.name,
        email: formData.email,
        avatar: avatarUrl,
        careScore: 0,
        createdAt: serverTimestamp(),
      });
      setFormData({ name: '', email: '', password: '', avatar: null });
      alert('Register successful!');
    } catch (e) {
      alert('Register failed: ' + e.message);
    }
  };

  // Login
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, formData.email, formData.password);
      setFormData({ name: '', email: '', password: '', avatar: null });
    } catch (e) {
      alert('Login failed: ' + e.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const isAdmin = currentUser?.email === ADMIN_EMAIL;

  // Get my buddy
  const getMyBuddy = () => {
    if (!userProfile) return null;
    const buddyId = buddyAssignments[userProfile.id];
    if (!buddyId) return null;
    return users.find(u => u.id === buddyId);
  };

  const getMySecretBuddy = () => {
    if (!userProfile) return null;
    const carerId = Object.keys(buddyAssignments).find(
      uid => buddyAssignments[uid] === userProfile.id
    );
    if (!carerId) return null;
    return users.find(u => u.id === carerId);
  };

  // Generate buddy chain - random matching only
  const handleGenerateBuddies = async () => {
    if (users.length < 2) {
      alert('Need at least 2 users!');
      return;
    }
    const shuffled = [...users].sort(() => Math.random() - 0.5);
    const newAssignments = {};
    for (let i = 0; i < shuffled.length; i++) {
      newAssignments[shuffled[i].id] = shuffled[(i + 1) % shuffled.length].id;
    }
    await setDoc(doc(db, 'config', 'buddyAssignments'), { assignments: newAssignments });
    alert(`Buddy chain generated for ${shuffled.length} users! 🎉`);
  };

  // Update user profile (name + avatar)
  const handleUpdateProfile = async () => {
    if (!userProfile) return;
    if (!editProfileData.name.trim()) {
      alert('Name cannot be empty!');
      return;
    }

    try {
      let avatarUrl = userProfile.avatar; // Keep existing avatar if no new one
      if (editProfileData.avatar) {
        avatarUrl = await uploadImage(editProfileData.avatar, true);
      }

      await updateDoc(doc(db, 'users', userProfile.id), {
        name: editProfileData.name.trim(),
        avatar: avatarUrl,
      });

      setShowEditProfile(false);
      setEditProfileData({ name: '', avatar: null, avatarPreview: null });
      alert('Profile updated successfully! 🎉');
    } catch (e) {
      console.error(e);
      alert('Update error: ' + e.message);
    }
  };

  // Open edit profile modal
  const openEditProfile = () => {
    setEditProfileData({
      name: userProfile?.name || '',
      avatar: null,
      avatarPreview: userProfile?.avatar || null,
    });
    setShowEditProfile(true);
  };

  // Delete a user (Admin only)
  const handleDeleteUser = async (userId, userName) => {
    if (!confirm(`Delete user "${userName}"? This cannot be undone!`)) return;
    
    try {
      // Delete user document
      await deleteDoc(doc(db, 'users', userId));
      
      // Remove from buddy assignments if exists
      const newAssignments = { ...buddyAssignments };
      delete newAssignments[userId];
      // Also remove if any user has this user as buddy
      Object.keys(newAssignments).forEach(uid => {
        if (newAssignments[uid] === userId) {
          delete newAssignments[uid];
        }
      });
      await setDoc(doc(db, 'config', 'buddyAssignments'), { assignments: newAssignments });
      
      // Delete user's requests
      const userRequests = requests.filter(r => r.userId === userId);
      for (const req of userRequests) {
        await deleteDoc(doc(db, 'requests', req.id));
      }
      
      // Delete user's cares (sent and received)
      const userCares = cares.filter(c => c.fromUserId === userId || c.toUserId === userId);
      for (const care of userCares) {
        await deleteDoc(doc(db, 'cares', care.id));
      }
      
      alert(`User "${userName}" deleted successfully!`);
    } catch (e) {
      console.error(e);
      alert('Delete error: ' + e.message);
    }
  };

  // Reset everything
  const handleResetBuddies = async () => {
    try {
      // Clear assignments
      await setDoc(doc(db, 'config', 'buddyAssignments'), { assignments: {} });
      
      // Reset all care scores
      const batch = writeBatch(db);
      for (const user of users) {
        batch.update(doc(db, 'users', user.id), { careScore: 0 });
      }
      await batch.commit();

      // Delete all requests
      for (const req of requests) {
        await deleteDoc(doc(db, 'requests', req.id));
      }

      // Delete all cares
      for (const care of cares) {
        await deleteDoc(doc(db, 'cares', care.id));
      }

      // Delete all notifications
      const notifsSnap = await getDocs(collection(db, 'notifications'));
      for (const docSnap of notifsSnap.docs) {
        await deleteDoc(doc(db, 'notifications', docSnap.id));
      }

      alert('Everything has been reset to default! 🔄');
    } catch (e) {
      console.error(e);
      alert('Reset error: ' + e.message);
    }
  };

  // Update reveal time
  const handleUpdateRevealTime = async (newTime) => {
    await setDoc(doc(db, 'config', 'revealTime'), { time: newTime });
  };

  // Post request
  const handlePostRequest = async (description) => {
    if (!userProfile) return;
    await addDoc(collection(db, 'requests'), {
      userId: userProfile.id,
      userName: userProfile.name,
      description,
      createdAt: new Date().toISOString(),
      fulfilled: false,
      careItems: [],
    });

    // Notify secret buddy (the person who takes care of me)
    const carerId = Object.keys(buddyAssignments).find(
      uid => buddyAssignments[uid] === userProfile.id
    );
    if (carerId) {
      await addDoc(collection(db, 'notifications'), {
        toUserId: carerId,
        type: 'request',
        message: `${userProfile.name} just asked for care! 💝`,
        read: false,
        createdAt: new Date().toISOString(),
      });
    }
  };

  const handleDeleteRequest = async (requestId) => {
    await deleteDoc(doc(db, 'requests', requestId));
  };

  // Send a care - +1 care score
  const handleSendCare = async (message, imageFile) => {
    if (!userProfile) return;
    const myBuddy = getMyBuddy();
    if (!myBuddy) {
      alert('No buddy assigned!');
      return;
    }

    let imageUrl = null;
    if (imageFile) {
      imageUrl = await uploadImage(imageFile);
    }

    await addDoc(collection(db, 'cares'), {
      fromUserId: userProfile.id,
      fromUserName: userProfile.name,
      toUserId: myBuddy.id,
      toUserName: myBuddy.name,
      message,
      image: imageUrl,
      createdAt: new Date().toISOString(),
      comments: [],
      likes: [],
    });

    await updateDoc(doc(db, 'users', userProfile.id), {
      careScore: increment(1)
    });

    await addDoc(collection(db, 'notifications'), {
      toUserId: myBuddy.id,
      type: 'care',
      message: 'Someone (your secret buddy) sent you a care! 🤫💝',
      read: false,
      createdAt: new Date().toISOString(),
    });
  };

  // Fulfill request - acknowledgment only
  const handleFulfillRequest = async (requestId) => {
    if (!userProfile) return;
    const myBuddy = getMyBuddy();
    if (!myBuddy) return;

    await updateDoc(doc(db, 'requests', requestId), {
      fulfilled: true,
      careItems: arrayUnion({
        fromUserId: userProfile.id,
        createdAt: new Date().toISOString(),
      })
    });

    await addDoc(collection(db, 'notifications'), {
      toUserId: myBuddy.id,
      type: 'fulfill',
      message: 'Your secret buddy got your request! 🤫🎉',
      read: false,
      createdAt: new Date().toISOString(),
    });
  };

  const handleAddComment = async (careId, comment) => {
    if (!userProfile) return;
    await updateDoc(doc(db, 'cares', careId), {
      comments: arrayUnion({
        userId: userProfile.id,
        userName: userProfile.name,
        text: comment,
        createdAt: new Date().toISOString(),
      })
    });
  };

  const handleLikeCare = async (careId, currentLikes) => {
    if (!userProfile) return;
    const careRef = doc(db, 'cares', careId);
    if (currentLikes.includes(userProfile.id)) {
      await updateDoc(careRef, { likes: arrayRemove(userProfile.id) });
    } else {
      await updateDoc(careRef, { likes: arrayUnion(userProfile.id) });
    }
  };

  const markNotificationAsRead = async (notifId) => {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter(n => !n.read);
    for (const n of unread) {
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const myBuddy = getMyBuddy();
  const mySecretBuddy = getMySecretBuddy();
  const timeRemaining = formatTimeRemaining(boardRevealTime);
  const leaderboard = [...users].sort((a, b) => (b.careScore || 0) - (a.careScore || 0));
  const getMyRequests = () => requests.filter(r => r.userId === userProfile?.id);
  const getMyBuddyRequests = () => myBuddy ? requests.filter(r => r.userId === myBuddy.id) : [];
  const getMyCaresReceived = () => cares.filter(c => c.toUserId === userProfile?.id);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50">
        <div className="text-center">
          <div className="text-6xl mb-4">💝</div>
          <p className="text-gray-600 font-bold">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 font-['Segoe_UI']">
      {/* LOGIN PAGE */}
      {!currentUser && page === 'login' && (
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-3xl shadow-2xl p-8 border-2 border-purple-200">
              <div className="text-center mb-8">
                <div className="text-5xl mb-3">💝</div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">Buddy BCD 185</h1>
              </div>

              <form onSubmit={handleLogin} className="space-y-4 mb-4">
                <input type="email" placeholder="Email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-3 border-2 border-purple-200 rounded-xl focus:outline-none focus:border-purple-500" required />
                <input type="password" placeholder="Password" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} className="w-full px-4 py-3 border-2 border-purple-200 rounded-xl focus:outline-none focus:border-purple-500" required />
                <button type="submit" className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 rounded-xl hover:shadow-lg transition transform hover:scale-105">Login</button>
              </form>

              <div className="text-center">
                <p className="text-gray-600 text-sm mb-3">Don't have an account?</p>
                <button onClick={() => setPage('register')} className="text-purple-600 font-bold hover:underline">Register here →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REGISTER PAGE */}
      {!currentUser && page === 'register' && (
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-3xl shadow-2xl p-8 border-2 border-blue-200">
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">🎉</div>
                <h1 className="text-3xl font-bold text-blue-600">Join the Fun!</h1>
              </div>

              <form onSubmit={handleRegister} className="space-y-4 mb-4">
                {/* Avatar Upload */}
                <div className="flex flex-col items-center mb-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (file) {
                          setFormData({...formData, avatar: file});
                        }
                      }}
                      className="hidden"
                    />
                    {formData.avatar ? (
                      <img src={URL.createObjectURL(formData.avatar)} alt="Avatar" className="w-24 h-24 rounded-full object-cover border-4 border-blue-400" />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-blue-100 border-4 border-dashed border-blue-300 flex items-center justify-center hover:bg-blue-200 transition">
                        <div className="text-center">
                          <ImageIcon size={28} className="mx-auto text-blue-500" />
                          <p className="text-xs text-blue-600 mt-1">Add Photo</p>
                        </div>
                      </div>
                    )}
                  </label>
                  <p className="text-xs text-gray-500 mt-2">Tap to upload your photo (optional)</p>
                </div>

                <input type="text" placeholder="Your Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-3 border-2 border-blue-200 rounded-xl focus:outline-none focus:border-blue-500" required />
                <input type="email" placeholder="Email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-3 border-2 border-blue-200 rounded-xl focus:outline-none focus:border-blue-500" required />
                <input type="password" placeholder="Password (6+ chars)" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} className="w-full px-4 py-3 border-2 border-blue-200 rounded-xl focus:outline-none focus:border-blue-500" minLength="6" required />
                <button type="submit" className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold py-3 rounded-xl hover:shadow-lg transition transform hover:scale-105">Register</button>
              </form>

              <div className="text-center">
                <button onClick={() => setPage('login')} className="text-blue-600 font-bold hover:underline text-sm">← Back to login</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MAIN APP */}
      {currentUser && userProfile && (
        <>
          {/* Header */}
          <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg sticky top-0 z-50">
            <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center gap-2">
              <div className="min-w-0">
                <h1 className="text-xl font-bold whitespace-nowrap">Buddy BCD 185</h1>
                <p className="text-purple-200 text-sm truncate">Welcome, {userProfile.name}!</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => setPage('notifications')} className="relative p-2 hover:bg-white/20 rounded-lg transition">
                  <Bell size={24} />
                  {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">{unreadCount}</span>
                  )}
                </button>
                <button onClick={openEditProfile} className="p-2 hover:bg-white/20 rounded-lg transition" title="Edit Profile">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <button onClick={handleLogout} className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition font-bold">
                  <LogOut size={18} /> Logout
                </button>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="bg-white border-b border-gray-200 sticky top-16 z-40">
            <div className="max-w-6xl mx-auto flex gap-6 px-4 py-3 overflow-x-auto">
              <button onClick={() => setPage('dashboard')} className={`font-bold text-lg pb-2 whitespace-nowrap ${page === 'dashboard' ? 'text-purple-600 border-b-3 border-purple-600' : 'text-gray-600'}`}>🏠 Home</button>
              <button onClick={() => setPage('care')} className={`font-bold text-lg pb-2 whitespace-nowrap ${page === 'care' ? 'text-pink-600 border-b-3 border-pink-600' : 'text-gray-600'}`}><Heart size={20} className="inline mr-1" />Care</button>
              <button onClick={() => setPage('careboard')} className={`font-bold text-lg pb-2 whitespace-nowrap ${page === 'careboard' ? 'text-blue-600 border-b-3 border-blue-600' : 'text-gray-600'}`}>📋 Care Board</button>
              <button onClick={() => setPage('leaderboard')} className={`font-bold text-lg pb-2 whitespace-nowrap ${page === 'leaderboard' ? 'text-yellow-600 border-b-3 border-yellow-600' : 'text-gray-600'}`}><Trophy size={20} className="inline mr-1" />Rankings</button>
              {isAdmin && (
                <button onClick={() => setPage('admin')} className={`font-bold text-lg pb-2 whitespace-nowrap ${page === 'admin' ? 'text-red-600 border-b-3 border-red-600' : 'text-gray-600'}`}>👥 Users</button>
              )}
            </div>
          </div>

          {/* DASHBOARD */}
          {page === 'dashboard' && (
            <div className="max-w-6xl mx-auto p-4 space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* My Buddy */}
                <div className="bg-gradient-to-br from-pink-100 to-red-100 rounded-3xl p-8 border-3 border-pink-300 shadow-lg">
                  <div className="text-center">
                    <div className="text-5xl mb-3">🎯</div>
                    <h2 className="text-xl font-bold text-pink-700 mb-2">You Take Care Of:</h2>
                    {myBuddy ? (
                      <div>
                        {myBuddy.avatar ? (
                          <img src={myBuddy.avatar} alt={myBuddy.name} className="w-20 h-20 rounded-full object-cover border-4 border-pink-400 mx-auto mb-3 shadow-lg" />
                        ) : (
                          <div className="w-20 h-20 rounded-full bg-pink-200 flex items-center justify-center text-3xl font-bold text-pink-700 mx-auto mb-3 border-4 border-pink-400 shadow-lg">
                            {myBuddy.name?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <p className="text-3xl font-bold text-pink-600 mb-2">{myBuddy.name}</p>
                        <Eye size={20} className="inline text-pink-500" />
                        <p className="text-xs text-gray-600 mt-2">Send care anonymously! 💝</p>
                      </div>
                    ) : (
                      <p className="text-gray-600">No buddy assigned yet</p>
                    )}
                  </div>
                </div>

                {/* Secret Buddy */}
                <div className="bg-gradient-to-br from-purple-100 to-indigo-100 rounded-3xl p-8 border-3 border-purple-300 shadow-lg">
                  <div className="text-center">
                    <div className="text-5xl mb-3">{isBuddyRevealed ? '🎉' : '🤫'}</div>
                    <h2 className="text-xl font-bold text-purple-700 mb-2">
                      {isBuddyRevealed ? 'Your Secret Buddy:' : 'Who Takes Care of You:'}
                    </h2>
                    {mySecretBuddy ? (
                      isBuddyRevealed ? (
                        <div>
                          {mySecretBuddy.avatar ? (
                            <img src={mySecretBuddy.avatar} alt={mySecretBuddy.name} className="w-20 h-20 rounded-full object-cover border-4 border-purple-400 mx-auto mb-3 shadow-lg" />
                          ) : (
                            <div className="w-20 h-20 rounded-full bg-purple-200 flex items-center justify-center text-3xl font-bold text-purple-700 mx-auto mb-3 border-4 border-purple-400 shadow-lg">
                              {mySecretBuddy.name?.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <p className="text-3xl font-bold text-purple-600 mb-2">{mySecretBuddy.name}</p>
                          <p className="text-xs text-gray-600">Revealed! 🎊</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-3xl font-bold text-purple-400 mb-2">??? 🤫</p>
                          <EyeOff size={20} className="inline text-purple-500" />
                          <p className="text-xs text-gray-600 mt-2">Will be revealed on the final day!</p>
                        </div>
                      )
                    ) : (
                      <p className="text-gray-600">No buddy assigned yet</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-blue-100 to-cyan-100 rounded-3xl p-6 border-3 border-blue-300">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-600 font-bold">Care Score</p>
                      <p className="text-4xl font-bold text-blue-600">{userProfile.careScore || 0}</p>
                    </div>
                    <div className="text-5xl">⭐</div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-yellow-100 to-orange-100 rounded-3xl p-6 border-3 border-yellow-300">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-600 font-bold">Total Users</p>
                      <p className="text-4xl font-bold text-yellow-600">{users.length}</p>
                    </div>
                    <div className="text-5xl">👫</div>
                  </div>
                </div>
              </div>

              {/* Admin Section */}
              {users.length >= 2 && isAdmin && (
                <div className="bg-gradient-to-r from-indigo-100 to-purple-100 rounded-3xl p-6 border-2 border-indigo-300">
                  <h3 className="text-xl font-bold text-indigo-700 mb-3">🎲 Buddy Matching</h3>
                  <div className="bg-yellow-100 border-2 border-yellow-400 rounded-lg p-2 mb-3">
                    <p className="text-xs text-yellow-800 font-bold">🔒 Admin Only Section</p>
                  </div>
                  <p className="text-sm text-gray-700 mb-3">Generate buddy chain for all users (A → B → C → ... → A)</p>
                  <p className="text-xs text-orange-600 mb-3">⚠️ Reset will clear all data (buddies, scores, requests, cares)</p>
                  <div className="flex gap-2 mb-4">
                    <button onClick={handleGenerateBuddies} className="bg-indigo-500 text-white font-bold px-6 py-2 rounded-lg hover:bg-indigo-600">🎯 Generate Buddies</button>
                    <button onClick={handleResetBuddies} className="bg-red-300 text-red-800 font-bold px-6 py-2 rounded-lg hover:bg-red-400">🔄 Reset All</button>
                  </div>

                  <div className="bg-white rounded-xl p-4 border-2 border-indigo-200">
                    <h4 className="text-sm font-bold text-indigo-700 mb-2">⏰ Set Buddy Reveal Date & Time</h4>
                    <p className="text-xs text-gray-600 mb-3">
                      Current: <span className="font-bold text-indigo-600">
                        {new Date(boardRevealTime).toLocaleString('en-GB', { 
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </p>
                    <div className="flex flex-col gap-2">
                      <div className="w-full" style={{ paddingRight: '4px' }}>
                        <input
                          type="datetime-local"
                          value={(() => {
                            const d = new Date(boardRevealTime);
                            const offset = d.getTimezoneOffset() * 60000;
                            return new Date(d.getTime() - offset).toISOString().slice(0, 16);
                          })()}
                          onChange={(e) => {
                            if (e.target.value) {
                              handleUpdateRevealTime(new Date(e.target.value).toISOString());
                            }
                          }}
                          style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                          className="px-3 py-2 border-2 border-indigo-300 rounded-lg focus:outline-none focus:border-indigo-500 text-sm"
                        />
                      </div>
                      <p className="text-xs text-gray-500">💡 Changes apply instantly to all users</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-gradient-to-r from-blue-100 to-purple-100 rounded-3xl p-6 border-2 border-blue-300">
                <h3 className="text-xl font-bold text-blue-700 mb-3">ℹ️ How It Works</h3>
                <div className="space-y-2 text-sm text-gray-700">
                  <p>👁️ <span className="font-bold">You see who YOU take care of</span></p>
                  <p>🤫 <span className="font-bold">You DON'T see who takes care of YOU</span></p>
                  <p>🎉 <span className="font-bold">Reveal:</span></p>
                  <p className="text-blue-600 font-bold pl-6">
                    {new Date(boardRevealTime).toLocaleString('en-GB', { 
                      day: '2-digit', month: 'long', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </p>
                  <p className="text-xs text-gray-600 pl-6">⏰ {timeRemaining}</p>
                </div>
              </div>

              {/* All Members Section */}
              <div className="bg-white rounded-3xl p-6 border-2 border-gray-200 shadow-lg">
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">👫</div>
                  <h3 className="text-2xl font-bold text-gray-800">All Members</h3>
                  <p className="text-gray-600 text-sm mt-1">{users.length} people in this seminar 💝</p>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                  {users.map(user => (
                    <div
                      key={user.id}
                      onClick={() => setSelectedMember(user)}
                      className="flex flex-col items-center bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-3 border-2 border-purple-100 cursor-pointer hover:border-purple-400 hover:shadow-md transition"
                    >
                      {user.avatar ? (
                        <img src={user.avatar} alt={user.name} className="w-16 h-16 rounded-full object-cover border-2 border-purple-300 shadow" />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-purple-200 flex items-center justify-center text-2xl font-bold text-purple-700 border-2 border-purple-300 shadow">
                          {user.name?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <p className="text-xs font-bold text-gray-800 mt-2 text-center truncate w-full">{user.name}</p>
                    </div>
                  ))}
                </div>
                {users.length === 0 && (
                  <div className="bg-gray-50 rounded-2xl p-6 text-center">
                    <p className="text-gray-600">No members yet</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CARE PAGE */}
          {page === 'care' && (
            <div className="max-w-6xl mx-auto p-4 space-y-6">
              {/* 1. Cares You Received - MOVED TO TOP */}
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-3xl p-8 border-2 border-purple-200">
                <h3 className="text-2xl font-bold mb-2 text-gray-800">💌 Cares You Received</h3>
                <p className="text-sm text-gray-500 mb-4">🤫 From your secret buddy!</p>
                <div className="space-y-4">
                  {getMyCaresReceived().length > 0 ? (
                    getMyCaresReceived().map(care => (
                      <div key={care.id} className="bg-white rounded-2xl p-6 border-2 border-purple-200">
                        <p className="font-bold text-purple-700 mb-3">
                          🤫 {isBuddyRevealed ? users.find(u => u.id === care.fromUserId)?.name + ' sent:' : 'Your Secret Buddy sent:'}
                        </p>
                        {care.image && <img src={care.image} alt="Care" className="rounded-lg max-w-[200px] max-h-[200px] object-cover my-2" />}
                        <p className="text-gray-700 italic">"{care.message}"</p>
                      </div>
                    ))
                  ) : (
                    <div className="bg-white rounded-2xl p-8 text-center border-2 border-purple-300">
                      <p className="text-gray-600">No cares received yet</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Send a Care */}
              <div className="bg-white rounded-3xl p-8 border-2 border-pink-200 shadow-lg">
                <h3 className="text-2xl font-bold mb-2 text-gray-800">🎁 Send a Care to {myBuddy?.name || 'Your Buddy'}</h3>
                <p className="text-sm text-gray-500 mb-4">🤫 Anonymous until reveal day!</p>
                {myBuddy ? (
                  <SendCareForm 
                    buddyName={myBuddy?.name}
                    onSubmit={async (message, imageFile) => {
                      await handleSendCare(message, imageFile);
                      alert('Care sent anonymously! 🤫💝');
                    }}
                  />
                ) : (
                  <p className="text-gray-600">No buddy assigned yet!</p>
                )}
              </div>

              {/* 3. Buddy's Care Requests */}
              <div className="bg-gradient-to-br from-pink-50 to-red-50 rounded-3xl p-8 border-2 border-pink-200">
                <h3 className="text-2xl font-bold mb-4 text-gray-800">💝 {myBuddy?.name || 'Buddy'}'s Care Requests</h3>
                <div className="space-y-4">
                  {getMyBuddyRequests().length > 0 ? (
                    getMyBuddyRequests().map(req => (
                      <BuddyRequestCard
                        key={req.id}
                        request={req}
                        buddy={myBuddy}
                        userProfile={userProfile}
                        onFulfill={() => handleFulfillRequest(req.id)}
                      />
                    ))
                  ) : (
                    <div className="bg-white rounded-2xl p-8 text-center border-2 border-pink-300">
                      <p className="text-gray-600">No requests from {myBuddy?.name || 'buddy'}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Ask for Care */}
              <div className="bg-white rounded-3xl p-8 border-2 border-gray-200 shadow-lg">
                <h3 className="text-2xl font-bold mb-4 text-gray-800">📝 Ask for Care</h3>
                <PostRequestForm onSubmit={async (desc) => {
                  await handlePostRequest(desc);
                  alert('Request posted! 💝');
                }} />
              </div>

              {/* 5. My Requests - MOVED TO BOTTOM */}
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-3xl p-8 border-2 border-blue-200">
                <h3 className="text-2xl font-bold mb-4 text-gray-800">🙋 My Requests</h3>
                <div className="space-y-4">
                  {getMyRequests().length > 0 ? (
                    getMyRequests().map(req => (
                      <div key={req.id} className="bg-white rounded-2xl p-6 border-2 border-blue-200 shadow-md relative">
                        <button
                          onClick={() => handleDeleteRequest(req.id)}
                          className="absolute top-3 right-3 bg-red-100 hover:bg-red-200 text-red-600 p-2 rounded-full transition"
                        >
                          <X size={18} />
                        </button>
                        <div className="mb-3 pr-10">
                          <p className="font-bold text-blue-700">Your Request:</p>
                          <p className="text-lg text-gray-800 mt-1">{req.description}</p>
                        </div>
                        {req.fulfilled ? (
                          <div className="bg-gray-100 border-2 border-gray-300 rounded-xl p-4 mt-4">
                            <p className="font-bold text-gray-700 text-lg">✅ Secret buddy got it.</p>
                          </div>
                        ) : (
                          <div className="bg-yellow-100 border-2 border-yellow-300 rounded-xl p-3 mt-4">
                            <p className="text-sm text-yellow-700">⏳ Waiting for your secret buddy...</p>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="bg-gray-50 rounded-2xl p-8 text-center border-2 border-gray-200">
                      <p className="text-gray-600">No requests yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* CARE BOARD */}
          {page === 'careboard' && (
            <div className="max-w-6xl mx-auto p-4 space-y-6">
              <div className="bg-white rounded-3xl p-8 border-2 border-gray-200 shadow-lg">
                <div className="text-center mb-6">
                  <div className="text-5xl mb-3">📋</div>
                  <h2 className="text-3xl font-bold text-gray-800">Care Board</h2>
                  <p className="text-gray-600 mt-2">All the love being shared 💝</p>
                </div>
                <div className="space-y-4">
                  {cares.length > 0 ? (
                    [...cares].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(care => (
                      <CareCard
                        key={care.id}
                        care={care}
                        users={users}
                        userProfile={userProfile}
                        isBuddyRevealed={isBuddyRevealed}
                        onComment={(comment) => handleAddComment(care.id, comment)}
                        onLike={() => handleLikeCare(care.id, care.likes || [])}
                      />
                    ))
                  ) : (
                    <div className="bg-gray-50 rounded-2xl p-8 text-center">
                      <p className="text-gray-600">No cares yet...</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* NOTIFICATIONS */}
          {page === 'notifications' && (
            <div className="max-w-4xl mx-auto p-4">
              <div className="bg-white rounded-3xl p-8 border-2 border-gray-200 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-3xl font-bold text-gray-800">🔔 Notifications</h2>
                  {unreadCount > 0 && (
                    <button onClick={markAllAsRead} className="text-sm bg-blue-500 text-white px-4 py-2 rounded-lg font-bold">Mark All as Read</button>
                  )}
                </div>
                <div className="space-y-3">
                  {notifications.length > 0 ? (
                    [...notifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(notif => (
                      <div 
                        key={notif.id}
                        onClick={() => markNotificationAsRead(notif.id)}
                        className={`rounded-xl p-4 border-2 cursor-pointer ${notif.read ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-400'}`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-bold text-gray-800">{notif.message}</p>
                            <p className="text-xs text-gray-500 mt-1">{new Date(notif.createdAt).toLocaleString()}</p>
                          </div>
                          {!notif.read && <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-bold">NEW</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500 text-center py-8">No notifications yet</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* LEADERBOARD */}
          {page === 'leaderboard' && (
            <div className="max-w-4xl mx-auto p-4">
              {!isBuddyRevealed && !isAdmin ? (
                <div className="bg-gradient-to-br from-red-100 to-pink-100 rounded-3xl p-12 border-3 border-red-300 text-center shadow-lg">
                  <div className="text-6xl mb-4">🔒</div>
                  <h2 className="text-3xl font-bold text-red-600 mb-2">Rankings Locked</h2>
                  <p className="text-gray-700 text-lg mb-4">Wait for the reveal day!</p>
                  <div className="bg-red-300 text-red-900 px-6 py-3 rounded-2xl inline-block font-bold text-lg">⏰ {timeRemaining}</div>
                  <p className="text-gray-600 mt-6 text-sm">Unlocks at <span className="font-bold">
                    {new Date(boardRevealTime).toLocaleString('en-GB', { 
                      day: '2-digit', month: 'long', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </span></p>
                </div>
              ) : (
                <div className="space-y-6">
                  {!isBuddyRevealed && isAdmin && (
                    <div className="bg-yellow-100 border-2 border-yellow-400 rounded-xl p-3">
                      <p className="text-sm text-yellow-800 font-bold">🔒 Admin Preview - Rankings still locked for other users</p>
                    </div>
                  )}

                  <div className="bg-white rounded-3xl p-8 border-2 border-gray-200 shadow-lg">
                    <div className="text-center mb-8">
                      <div className="text-6xl mb-3">🏆</div>
                      <h2 className="text-4xl font-bold bg-gradient-to-r from-yellow-500 to-orange-500 bg-clip-text text-transparent">Best Buddies</h2>
                    </div>
                    <div className="space-y-3">
                      {leaderboard.map((user, index) => (
                        <div key={user.id} className={`rounded-2xl p-4 flex items-center justify-between border-2 ${index === 0 ? 'bg-gradient-to-r from-yellow-100 to-orange-100 border-yellow-400' : index === 1 ? 'bg-gradient-to-r from-gray-100 to-slate-100 border-gray-400' : index === 2 ? 'bg-gradient-to-r from-orange-50 to-red-50 border-orange-300' : 'bg-white border-gray-200'}`}>
                          <div className="flex items-center gap-3">
                            <div className="text-3xl font-bold w-10 text-center">{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`}</div>
                            {user.avatar ? (
                              <img src={user.avatar} alt={user.name} className="w-12 h-12 rounded-full object-cover border-2 border-white shadow" />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-purple-200 flex items-center justify-center text-xl font-bold text-purple-700">
                                {user.name?.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <p className="font-bold text-sm text-gray-800 truncate max-w-[120px]">{user.name}</p>
                              <p className="text-xs text-gray-500">Care Score: {user.careScore || 0}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Star className="text-yellow-500 fill-yellow-500" size={24} />
                            <span className="text-2xl font-bold text-yellow-600">{user.careScore || 0}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Buddy Chain */}
                  <div className="bg-white rounded-3xl p-8 border-2 border-gray-200 shadow-lg">
                    <div className="text-center mb-6">
                      <div className="text-5xl mb-3">🔗</div>
                      <h2 className="text-3xl font-bold text-gray-800">Buddy Chain</h2>
                      <p className="text-gray-600 mt-2">Who takes care of whom 💝</p>
                    </div>

                    {Object.keys(buddyAssignments).length > 0 ? (
                      <div className="space-y-3">
                        {Object.entries(buddyAssignments).map(([userId, buddyId]) => {
                          const user = users.find(u => u.id === userId);
                          const buddyOfUser = users.find(u => u.id === buddyId);
                          if (!user || !buddyOfUser) return null;
                          // Helper to shorten name: show first 12 chars + ... if longer
                          const shortName = (name) => name?.length > 12 ? name.slice(0, 12) + '...' : name;
                          return (
                            <div key={userId} className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl p-3 border-2 border-purple-200">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  {user.avatar ? (
                                    <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full object-cover border-2 border-purple-300 shrink-0" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-purple-200 flex items-center justify-center text-sm font-bold text-purple-700 shrink-0">
                                      {user.name?.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <p className="font-bold text-xs text-purple-700" title={user.name}>{shortName(user.name)}</p>
                                </div>
                                <div className="text-lg shrink-0">💝</div>
                                <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                                  <p className="font-bold text-xs text-pink-700 text-right" title={buddyOfUser.name}>{shortName(buddyOfUser.name)}</p>
                                  {buddyOfUser.avatar ? (
                                    <img src={buddyOfUser.avatar} alt={buddyOfUser.name} className="w-8 h-8 rounded-full object-cover border-2 border-pink-300 shrink-0" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-pink-200 flex items-center justify-center text-sm font-bold text-pink-700 shrink-0">
                                      {buddyOfUser.name?.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded-2xl p-8 text-center border-2 border-gray-200">
                        <p className="text-gray-600">No buddy chain yet</p>
                        <p className="text-sm text-gray-500 mt-2">Generate buddies in Dashboard first!</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ADMIN USERS PAGE */}
          {page === 'admin' && isAdmin && (
            <div className="max-w-4xl mx-auto p-4">
              <div className="bg-white rounded-3xl p-8 border-2 border-red-200 shadow-lg">
                <div className="text-center mb-6">
                  <div className="text-5xl mb-3">👥</div>
                  <h2 className="text-3xl font-bold text-red-600">Manage Users</h2>
                  <p className="text-gray-600 mt-2">View and delete users (Admin Only)</p>
                </div>

                <div className="bg-yellow-100 border-2 border-yellow-400 rounded-xl p-3 mb-4">
                  <p className="text-sm text-yellow-800 font-bold">⚠️ Deleting a user will remove all their data (requests, cares, buddy assignments)</p>
                </div>

                <div className="bg-blue-50 rounded-xl p-3 mb-4 border-2 border-blue-200">
                  <p className="text-sm text-blue-700 font-bold">📊 Total Users: {users.length}</p>
                </div>

                <div className="space-y-3">
                  {users.length > 0 ? (
                    users.map(user => (
                      <div key={user.id} className="bg-gray-50 rounded-2xl p-4 border-2 border-gray-200 flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {user.avatar ? (
                            <img src={user.avatar} alt={user.name} className="w-12 h-12 rounded-full object-cover border-2 border-purple-300 shrink-0" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-purple-200 flex items-center justify-center text-xl font-bold text-purple-700 shrink-0">
                              {user.name?.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-800 truncate">{user.name}</p>
                            <p className="text-xs text-gray-500 truncate">{user.email}</p>
                            <p className="text-xs text-purple-600 font-bold">⭐ Score: {user.careScore || 0}</p>
                          </div>
                        </div>
                        {user.email !== ADMIN_EMAIL ? (
                          <button
                            onClick={() => handleDeleteUser(user.id, user.name)}
                            className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-lg shrink-0 ml-2"
                          >
                            🗑️ Delete
                          </button>
                        ) : (
                          <span className="bg-yellow-200 text-yellow-800 font-bold px-3 py-1 rounded-lg shrink-0 ml-2 text-sm">
                            🔒 Admin
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="bg-gray-50 rounded-2xl p-8 text-center">
                      <p className="text-gray-600">No users yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* MEMBER PROFILE MODAL */}
      {selectedMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4" onClick={() => setSelectedMember(null)}>
          <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setSelectedMember(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 text-2xl">✕</button>
            {selectedMember.avatar ? (
              <img src={selectedMember.avatar} alt={selectedMember.name} className="w-32 h-32 rounded-full object-cover border-4 border-purple-400 mx-auto mb-4 shadow-lg" />
            ) : (
              <div className="w-32 h-32 rounded-full bg-purple-200 flex items-center justify-center text-5xl font-bold text-purple-700 mx-auto mb-4 border-4 border-purple-400 shadow-lg">
                {selectedMember.name?.charAt(0).toUpperCase()}
              </div>
            )}
            <h2 className="text-2xl font-bold text-gray-800 mb-1">{selectedMember.name}</h2>
            <p className="text-gray-500 text-sm mb-4">{selectedMember.email}</p>
            <div className="bg-purple-50 rounded-xl p-3 border-2 border-purple-200">
              <p className="text-purple-700 font-bold text-lg">⭐ Care Score: {selectedMember.careScore || 0}</p>
            </div>
            <button onClick={() => setSelectedMember(null)} className="mt-4 w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-2 rounded-xl">Close</button>
          </div>
        </div>
      )}

      {/* EDIT PROFILE MODAL */}
      {showEditProfile && currentUser && userProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4" onClick={() => setShowEditProfile(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="text-5xl mb-2">✏️</div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">Edit Profile</h2>
              <p className="text-gray-500 text-sm mt-1">Update your name and avatar</p>
            </div>

            <div className="space-y-4">
              {/* Avatar Upload */}
              <div className="flex flex-col items-center">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setEditProfileData({
                            ...editProfileData,
                            avatar: file,
                            avatarPreview: reader.result,
                          });
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="hidden"
                  />
                  {editProfileData.avatarPreview ? (
                    <img src={editProfileData.avatarPreview} alt="Avatar" className="w-28 h-28 rounded-full object-cover border-4 border-purple-400 shadow-lg" />
                  ) : (
                    <div className="w-28 h-28 rounded-full bg-purple-100 border-4 border-dashed border-purple-300 flex items-center justify-center hover:bg-purple-200 transition">
                      <div className="text-center">
                        <ImageIcon size={32} className="mx-auto text-purple-500" />
                        <p className="text-xs text-purple-600 mt-1">Add Photo</p>
                      </div>
                    </div>
                  )}
                </label>
                <p className="text-xs text-gray-500 mt-2">Tap photo to change</p>
              </div>

              {/* Name */}
              <div>
                <label className="text-sm font-bold text-gray-700 mb-1 block">Your Name</label>
                <input
                  type="text"
                  value={editProfileData.name}
                  onChange={(e) => setEditProfileData({...editProfileData, name: e.target.value})}
                  placeholder="Enter your name"
                  className="w-full px-4 py-3 border-2 border-purple-200 rounded-xl focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Email (readonly) */}
              <div>
                <label className="text-sm font-bold text-gray-700 mb-1 block">Email (cannot change)</label>
                <input
                  type="email"
                  value={userProfile.email}
                  disabled
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-100 text-gray-500"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowEditProfile(false)}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateProfile}
                  className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 rounded-xl hover:shadow-lg transition"
                >
                  💾 Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Components
function PostRequestForm({ onSubmit }) {
  const [input, setInput] = useState('');
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (input.trim()) {
      await onSubmit(input);
      setInput('');
    }
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g., I want candy... 🍕" className="w-full p-4 border-2 border-pink-200 rounded-xl focus:outline-none resize-none" rows="3" />
      <button type="submit" className="w-full bg-gradient-to-r from-pink-500 to-red-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"><Send size={20} /> Send Request</button>
    </form>
  );
}

function SendCareForm({ buddyName, onSubmit }) {
  const [message, setMessage] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (message.trim() && !sending) {
      setSending(true);
      await onSubmit(message, imageFile);
      setMessage('');
      setImageFile(null);
      setPreview(null);
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`Send a care to ${buddyName}... 💝`} className="w-full p-4 border-2 border-pink-200 rounded-xl focus:outline-none resize-none" rows="3" />
      <div className="border-2 border-dashed border-pink-300 rounded-xl p-4">
        <label className="flex items-center justify-center cursor-pointer">
          <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
          <div className="text-center">
            <ImageIcon size={32} className="mx-auto text-pink-500 mb-2" />
            <p className="text-sm text-gray-600">Click to upload (optional)</p>
          </div>
        </label>
      </div>
      {preview && (
        <div className="relative inline-block">
          <img src={preview} alt="Preview" className="rounded-lg max-w-[200px] max-h-[200px] object-cover" />
          <button type="button" onClick={() => { setImageFile(null); setPreview(null); }} className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full"><X size={16} /></button>
        </div>
      )}
      <button type="submit" disabled={sending} className="w-full bg-gradient-to-r from-pink-500 to-red-500 text-white font-bold py-3 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">
        <Send size={20} /> {sending ? 'Sending...' : 'Send Care 🤫'}
      </button>
    </form>
  );
}

function BuddyRequestCard({ request, buddy, userProfile, onFulfill }) {
  const alreadyFulfilled = request.careItems?.some(item => item.fromUserId === userProfile.id);
  return (
    <div className="bg-white rounded-2xl p-6 border-2 border-pink-200 shadow-md">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-bold text-pink-700">{buddy?.name} wants:</p>
          <p className="text-lg text-gray-800 mt-1">{request.description}</p>
        </div>
        <span className="text-3xl">{alreadyFulfilled ? '✅' : '💭'}</span>
      </div>
      {alreadyFulfilled ? (
        <button disabled className="bg-gray-200 text-gray-500 font-bold px-6 py-3 rounded-xl cursor-not-allowed">✅ Got It!</button>
      ) : (
        <button onClick={onFulfill} className="bg-gradient-to-r from-pink-500 to-red-500 text-white font-bold px-6 py-3 rounded-xl">✨ I Got It!</button>
      )}
    </div>
  );
}

function CareCard({ care, users, userProfile, isBuddyRevealed, onComment, onLike }) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const sender = users.find(u => u.id === care.fromUserId);
  const recipient = users.find(u => u.id === care.toUserId);
  const isLiked = (care.likes || []).includes(userProfile.id);
  const isMyCare = care.fromUserId === userProfile.id;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (comment.trim()) {
      await onComment(comment);
      setComment('');
      setShowComment(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-6 border-2 border-purple-200">
      <p className="text-sm text-gray-600 mb-4">
        {isBuddyRevealed || isMyCare ? (
          <><span className="font-bold text-purple-700">{isMyCare ? 'You' : sender?.name}</span> sent care to <span className="font-bold text-pink-700">{recipient?.name}</span></>
        ) : (
          <><span className="font-bold text-purple-700">🤫 Secret Buddy</span> sent care to <span className="font-bold text-pink-700">{recipient?.name}</span></>
        )}
      </p>
      <p className="text-gray-700 mb-3">{care.message}</p>
      {care.image && <img src={care.image} alt="Care" className="rounded-lg max-w-[250px] max-h-[250px] object-cover mb-4" />}
      {(care.comments || []).length > 0 && (
        <div className="bg-white rounded-lg p-3 mb-4 border border-purple-200">
          <p className="text-xs font-bold text-purple-600 mb-2">💬 Comments:</p>
          {care.comments.map((c, idx) => (
            <div key={idx} className="text-sm mb-2 pb-2 border-b border-gray-200 last:border-0">
              <p className="font-bold text-gray-800">{c.userName}</p>
              <p className="text-gray-700">{c.text}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center flex-wrap">
        <button onClick={onLike} className={`flex items-center gap-1 px-3 py-2 rounded-lg font-bold ${isLiked ? 'bg-red-200 text-red-700' : 'bg-gray-200 text-gray-700'}`}>
          <Heart size={16} className={isLiked ? 'fill-current' : ''} />
          {(care.likes || []).length}
        </button>
        {!showComment ? (
          <button onClick={() => setShowComment(true)} className="px-3 py-2 bg-blue-200 text-blue-700 rounded-lg font-bold">💬 Comment</button>
        ) : (
          <form onSubmit={handleSubmit} className="flex gap-2 w-full mt-2">
            <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment..." className="flex-1 min-w-0 px-3 py-2 border-2 border-purple-300 rounded-lg text-sm" />
            <button type="submit" className="px-3 py-2 bg-blue-500 text-white rounded-lg font-bold shrink-0">Send</button>
            <button type="button" onClick={() => { setShowComment(false); setComment(''); }} className="px-3 py-2 bg-gray-300 text-gray-700 rounded-lg font-bold shrink-0">X</button>
          </form>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-3">{new Date(care.createdAt).toLocaleString()}</p>
    </div>
  );
}
