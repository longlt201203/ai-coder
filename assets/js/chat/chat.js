const vscode = acquireVsCodeApi();
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messageContainer = document.getElementById("messageContainer");
const modelSelector = document.getElementById("modelSelector");

// Store the currently selected model
let currentModel = modelSelector.value;

// Listen for model changes
modelSelector.addEventListener("change", (e) => {
  currentModel = e.target.value;
  // Notify VSCode about model change
  vscode.postMessage({
    type: "modelChanged",
    data: currentModel,
  });

  // Add system message about model change
  addSystemMessage(`Model changed to ${currentModel}`);
});

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "theme-changed") {
    // VSCode will automatically update CSS variables
    console.log("VSCode theme changed");
  }
});

messageInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

sendButton.addEventListener("click", sendMessage);

// Send message when Enter key is pressed (without Shift)
messageInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function sendMessage() {
  const message = messageInput.value.trim();
  if (message) {
    // Add user message to chat
    addMessage(message, "user");
    vscode.postMessage({
      type: "sendMessage",
      data: message,
    });

    // Clear input
    messageInput.value = "";
    messageInput.style.height = "auto";

    // In a real app, you would send the message to your backend here
    // For demo purposes, we'll just simulate a response
    setTimeout(() => {
      addMessage("I received your message and I'm processing it.", "ai");
    }, 1000);
  }
}

function addMessage(text, sender) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${sender}-message`;

  // Simplified message structure without avatars
  messageDiv.innerHTML = `
        <div class="message-content">
            <p>${text}</p>
        </div>
    `;

  messageContainer.appendChild(messageDiv);

  // Scroll to bottom
  messageContainer.scrollTop = messageContainer.scrollHeight;
}

function addSystemMessage(text) {
  const messageDiv = document.createElement("div");
  messageDiv.className = "message system-message";

  messageDiv.innerHTML = `
        <div class="message-content system-content">
            <p>${text}</p>
        </div>
    `;

  messageContainer.appendChild(messageDiv);
  messageContainer.scrollTop = messageContainer.scrollHeight;
}
