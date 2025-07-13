const socket = io();
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const roomInput = document.getElementById("room-input");
const joinBtn = document.getElementById("join-btn");

let localStream;
let peerConnection;
let room;

const config = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302", // Google's public STUN server
    },
  ],
};

joinBtn.onclick = async () => {
  room = roomInput.value;
  if (!room) return alert("Enter a room ID");

  await startMedia();

  socket.emit("join", room);
};

async function startMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.error("Could not get media", err);
  }
}

socket.on("ready", async () => {
  peerConnection = createPeerConnection();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", { offer, room });
});

socket.on("offer", async (offer) => {
  peerConnection = createPeerConnection();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { answer, room });
});

socket.on("answer", async (answer) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", async (candidate) => {
  if (peerConnection) {
    await peerConnection.addIceCandidate(candidate);
  }
});

function createPeerConnection() {
  const pc = new RTCPeerConnection(config);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { candidate: event.candidate, room });
    }
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  return pc;
}
// === Mute/Unmute Audio ===
const toggleAudioBtn = document.getElementById("toggle-audio");
toggleAudioBtn.onclick = () => {
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack.enabled) {
    audioTrack.enabled = false;
    toggleAudioBtn.textContent = "🔈 Unmute";
  } else {
    audioTrack.enabled = true;
    toggleAudioBtn.textContent = "🔇 Mute";
  }
};

// === Toggle Video On/Off ===
const toggleVideoBtn = document.getElementById("toggle-video");
toggleVideoBtn.onclick = () => {
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack.enabled) {
    videoTrack.enabled = false;
    toggleVideoBtn.textContent = "📷 Turn On Camera";
  } else {
    videoTrack.enabled = true;
    toggleVideoBtn.textContent = "📷 Turn Off Camera";
  }
};

const chatInput = document.getElementById("chat-message");
const sendBtn = document.getElementById("send-btn");
const chatBox = document.getElementById("chat-box");

// Send message
sendBtn.onclick = () => {
  const message = chatInput.value.trim();
  if (message && room) {
    socket.emit("chat-message", { message, room });
    appendMessage(`You: ${message}`);
    chatInput.value = "";
  }
};

// Receive message
socket.on("chat-message", (data) => {
  appendMessage(`Stranger: ${data.message}`);
});

// Append to chat box
function appendMessage(msg) {
  const div = document.createElement("div");
  div.className = "chat-message";
  div.textContent = msg;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}
