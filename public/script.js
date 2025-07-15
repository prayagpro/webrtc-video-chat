const socket = io();
let localStream, remoteStream, peerConnection;
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const joinBtn = document.getElementById("join-btn");
const roomInput = document.getElementById("room-input");
const toggleAudioBtn = document.getElementById("toggle-audio");
const toggleVideoBtn = document.getElementById("toggle-video");
const shareScreenBtn = document.getElementById("share-screen");

let room = null;
// Queue ICE candidates received before remote description is set
let pendingCandidates = [];

joinBtn.onclick = async () => {
  room = roomInput.value.trim();
  if (!room) return alert("Please enter a room ID");

  // Get user media first to avoid race condition with server's 'joined' event
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  // Create peer connection **before** telling the server we joined
  peerConnection = new RTCPeerConnection(config);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = e => remoteVideo.srcObject = e.streams[0];

  // pendingCandidates is global

  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("candidate", { candidate: e.candidate, room });
    }
  };

  // Now safely tell server we've joined
  socket.emit("join", room);

};

socket.on("joined", (isInitiator) => {
  // If this client is not the initiator, wait for the offer from the initiator.
  // No action needed here to avoid both peers creating offers simultaneously.
});

socket.on("peer-joined", async () => {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit("offer", { offer, room });
});

socket.on("offer", async ({ offer }) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  // Add any pending ICE candidates now that remote description is set
  for (const ice of pendingCandidates) {
    try {
      await peerConnection.addIceCandidate(ice);
    } catch (err) {
      console.error("Queued ICE error", err);
    }
  }
  pendingCandidates = [];

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit("answer", { answer, room });
});

socket.on("answer", async ({ answer }) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  // Flush any queued ICE candidates
  for (const ice of pendingCandidates) {
    try {
      await peerConnection.addIceCandidate(ice);
    } catch (err) {
      console.error("Queued ICE error", err);
    }
  }
  pendingCandidates = [];
});

socket.on("candidate", async ({ candidate }) => {
  if (!peerConnection) return;
  const ice = new RTCIceCandidate(candidate);
  if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
    try {
      await peerConnection.addIceCandidate(ice);
    } catch (err) {
      console.error("ICE candidate error", err);
    }
  } else {
    // Remote description not set yet; queue it
    pendingCandidates.push(ice);
  }
});

// === Mute/Unmute Audio ===
toggleAudioBtn.onclick = () => {
  const track = localStream?.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    toggleAudioBtn.textContent = track.enabled ? "🔇 Mute" : "🔈 Unmute";
  }
};

// === Toggle Video ===
toggleVideoBtn.onclick = () => {
  const track = localStream?.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    toggleVideoBtn.textContent = track.enabled ? "📷 Turn Off Camera" : "📷 Turn On Camera";
  }
};

// === Screen Sharing ===
shareScreenBtn.onclick = async () => {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track.kind === "video");
    if (sender) {
      sender.replaceTrack(screenTrack);
      localVideo.srcObject = screenStream;
      screenTrack.onended = () => {
        sender.replaceTrack(localStream.getVideoTracks()[0]);
        localVideo.srcObject = localStream;
      };
    }
  } catch (err) {
    alert("Screen sharing failed");
    console.error(err);
  }
};

// === Chat ===
const chatInput = document.getElementById("chat-message");
const sendBtn = document.getElementById("send-btn");
const chatBox = document.getElementById("chat-box");

sendBtn.onclick = () => {
  const message = chatInput.value.trim();
  if (message && room) {
    socket.emit("chat-message", { message, room });
    appendMessage(`You: ${message}`);
    chatInput.value = "";
  }
};

socket.on("chat-message", ({ message }) => {
  appendMessage(`Stranger: ${message}`);
});

function appendMessage(msg) {
  const div = document.createElement("div");
  div.className = "chat-message";
  div.textContent = msg;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// === CodeMirror Editor ===
const editor = CodeMirror.fromTextArea(document.getElementById("code-editor"), {
  mode: "javascript",
  theme: "material-darker",
  lineNumbers: true,
  tabSize: 2,
});

editor.on("change", () => {
  const code = editor.getValue();
  socket.emit("code-change", { code, room });
});

socket.on("code-change", ({ code }) => {
  if (editor.getValue() !== code) editor.setValue(code);
});

// === Run Code Securely ===
const runBtn = document.getElementById("run-code");
const codeOutput = document.getElementById("code-output");
const languageSelect = document.getElementById("language-select");

async function checkExecutionStatus(token) {
  try {
    const response = await fetch(`/api/execution/${token}`);
    const data = await response.json();
    
    if (data.status) {
      const status = data.status.description;
      
      if (status === 'In Queue' || status === 'Processing') {
        // Check again after 2 seconds if still processing
        setTimeout(() => checkExecutionStatus(token), 2000);
        return;
      }
      
      if (data.compile_output) {
        codeOutput.textContent = `Compilation Error: ${data.compile_output}`;
      } else if (data.stderr) {
        codeOutput.textContent = `Error: ${data.stderr}`;
      } else {
        codeOutput.textContent = data.stdout || "✅ Execution completed with no output";
      }
    } else {
      codeOutput.textContent = data.error || "❌ Error checking execution status";
    }
  } catch (err) {
    console.error('Error checking execution status:', err);
    codeOutput.textContent = "❌ Error checking execution status";
  }
}

runBtn.onclick = async () => {
  const source_code = editor.getValue();
  const language_id = languageSelect.value;
  
  if (!source_code) {
    codeOutput.textContent = "❌ Please enter some code to execute";
    return;
  }

  codeOutput.textContent = "⏳ Running...";
  runBtn.disabled = true;
  runBtn.textContent = "Running...";

  try {
    const response = await fetch('/api/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source_code, language_id })
    });

    const data = await response.json();
    
    if (data.token) {
      // Start polling for execution status
      checkExecutionStatus(data.token);
    } else {
      codeOutput.textContent = data.error || "❌ Failed to start code execution";
    }
  } catch (err) {
    console.error('Execution failed:', err);
    codeOutput.textContent = "❌ Error connecting to execution service";
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "▶️ Run Code";
  }
};
