
const vscode = acquireVsCodeApi();
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const contextItemsContainer = document.getElementById('contextItems');
const addContextBtn = document.getElementById('addContextBtn');
const clearContextBtn = document.getElementById('clearContextBtn');

// Send message function
function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        vscode.postMessage({ type: 'sendMessage', message });
        messageInput.value = '';
    }
}

// Event listeners
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Markdown formatting using marked.js
function formatText(text) {
    // Configure marked options
    marked.setOptions({
        breaks: true,        // Add line breaks on single newlines
        gfm: true,           // Use GitHub Flavored Markdown
        headerIds: false,    // Don't add IDs to headers
        langPrefix: 'language-', // CSS language prefix for code blocks
        highlight: function (code, lang) {
            // You could add a syntax highlighter here in the future
            return code;
        }
    });

    // Process the text with marked
    const html = marked.parse(text);

    // Add copy buttons to code blocks
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Find all pre elements and add copy buttons
    const preElements = tempDiv.querySelectorAll('pre');
    preElements.forEach(pre => {
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-code-button';
        copyButton.textContent = 'Copy';
        copyButton.addEventListener('click', function () {
            const code = pre.querySelector('code').innerText;
            navigator.clipboard.writeText(code).then(() => {
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy';
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy: ', err);
            });
        });
        pre.appendChild(copyButton);
    });

    // Special handling for file paths
    const codeElements = tempDiv.querySelectorAll('code');
    codeElements.forEach(code => {
        // If this is not inside a pre (it's an inline code)
        if (!code.parentElement.matches('pre')) {
            const text = code.innerText;
            // Check if it looks like a file path
            if (text.match(/\.(js|ts|py|html|css|json|md|cpp|h|cs|java|go|rb|php)$/i) ||
                text.includes('/') || text.includes('\\')) {
                code.classList.add('filepath');
            }
        }
    });

    return tempDiv.innerHTML;
}

// Handle context item updates from extension
// Update context items display
function updateContextItems(items) {
    console.log('Updating context items in UI:', items);
    const contextItemsContainer = document.getElementById('contextItems');

    if (!items || items.length === 0) {
        contextItemsContainer.innerHTML = '<div class="empty-context">No context items selected</div>';
        return;
    }

    // Create a Set to track unique paths and avoid duplicates
    const uniquePaths = new Set();
    let html = '';
    
    for (const item of items) {
        // Skip if we've already added this path
        if (uniquePaths.has(item.path)) {
            continue;
        }
        
        uniquePaths.add(item.path);
        const iconClass = item.isDirectory ? 'codicon-folder' : 'codicon-file';
        const iconType = item.isDirectory ? 'folder' : 'file';

        html += `
            <div class="context-item" data-path="${item.path}">
                <span class="context-item-icon ${iconType} codicon ${iconClass}"></span>
                <span class="context-item-name" title="${item.path}">${item.name}</span>
                <span class="context-item-remove codicon codicon-close" title="Remove from context"></span>
            </div>
        `;
    }

    contextItemsContainer.innerHTML = html;

    // Add event listeners to remove buttons
    document.querySelectorAll('.context-item-remove').forEach(button => {
        button.addEventListener('click', (e) => {
            const item = e.target.closest('.context-item');
            const path = item.dataset.path;
            vscode.postMessage({
                type: 'contextAction',
                action: 'remove',
                path: path
            });
            e.stopPropagation();
        });
    });
}

// Add context button click handler
addContextBtn.addEventListener('click', () => {
    // Show our custom file browser instead of sending a message to VS Code
    showFileBrowser();
});

// Clear context button click handler
clearContextBtn.addEventListener('click', () => {
    vscode.postMessage({
        type: 'contextAction',
        action: 'clear'
    });
});

// File browser state
let currentPath = '';
let selectedItems = new Set();

// File browser elements
const fileBrowserDialog = document.getElementById('fileBrowserDialog');
const currentPathElement = document.getElementById('currentPath');
const fileListElement = document.getElementById('fileList');
const selectedItemsCountElement = document.getElementById('selectedItemsCount');
const upDirBtn = document.getElementById('upDirBtn');
const homeBtn = document.getElementById('homeBtn');
const closeBrowserBtn = document.getElementById('closeBrowserBtn');
const cancelSelectBtn = document.getElementById('cancelSelectBtn');
const confirmSelectBtn = document.getElementById('confirmSelectBtn');

// Create modal overlay
const modalOverlay = document.createElement('div');
modalOverlay.className = 'modal-overlay';
document.body.appendChild(modalOverlay);

// Add event listeners for file browser buttons
upDirBtn.addEventListener('click', navigateUp);
homeBtn.addEventListener('click', () => {
    // Request workspace root directory
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: ''  // Empty path means get workspace root
    });
});
closeBrowserBtn.addEventListener('click', hideFileBrowser);
cancelSelectBtn.addEventListener('click', hideFileBrowser);
// Modify the confirmSelectBtn click handler
confirmSelectBtn.addEventListener('click', () => {
    if (selectedItems.size > 0) {
        const selectedPaths = Array.from(selectedItems);
        console.log('Sending selected paths to extension:', selectedPaths);
        
        vscode.postMessage({
            type: 'contextAction',
            action: 'addCustom',
            paths: selectedPaths
        });
        
        // Hide the file browser dialog
        hideFileBrowser();
    }
});

// Update the selected items count
function updateSelectedItemsCount() {
    if (selectedItemsCountElement) {
        selectedItemsCountElement.textContent = selectedItems.size;
    }
}

// Show file browser dialog
function showFileBrowser() {
    // Reset state
    selectedItems.clear();
    updateSelectedItemsCount();
    
    // Request initial directory listing from extension
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: '' // Empty path means get workspace root
    });
    
    // Show dialog and overlay
    fileBrowserDialog.style.display = 'flex';
    modalOverlay.style.display = 'block';
}

// Hide file browser dialog
function hideFileBrowser() {
    fileBrowserDialog.style.display = 'none';
    modalOverlay.style.display = 'none';
}

// Navigate to a directory
function navigateToDirectory(path) {
    currentPath = path;
    currentPathElement.textContent = path;
    
    // Clear selection when navigating
    selectedItems.clear();
    updateSelectedItemsCount();
    
    // Request directory listing from extension
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: path
    });
}

// Navigate up one directory
function navigateUp() {
    if (!currentPath) return;
    
    const parentPath = currentPath.split('\\').slice(0, -1).join('\\');
    navigateToDirectory(parentPath || '');
}

// Update the file list in the UI
function updateFileList(items) {
    fileListElement.innerHTML = '';
    
    items.forEach(item => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.path = item.path;
        fileItem.dataset.isDirectory = item.isDirectory;
        
        if (selectedItems.has(item.path)) {
            fileItem.classList.add('selected');
        }
        
        const icon = document.createElement('span');
        icon.className = `file-item-icon codicon ${item.isDirectory ? 'codicon-folder' : 'codicon-file'}`;
        
        const name = document.createElement('span');
        name.textContent = item.name;
        
        fileItem.appendChild(icon);
        fileItem.appendChild(name);
        
        // Add click handler
        fileItem.addEventListener('click', (e) => {
            if (item.isDirectory && e.detail === 2) {
                // Double click on directory - navigate into it
                navigateToDirectory(item.path);
            } else {
                // Single click - select/deselect
                if (selectedItems.has(item.path)) {
                    selectedItems.delete(item.path);
                    fileItem.classList.remove('selected');
                } else {
                    selectedItems.add(item.path);
                    fileItem.classList.add('selected');
                }
                updateSelectedItemsCount();
            }
        });
        
        fileListElement.appendChild(fileItem);
    });
}

// Extend the message handler to handle file browser responses
window.addEventListener('message', (event) => {
    const message = event.data;
    
    switch (message.type) {
        case 'addMessage':
            addMessage(message.message, message.sender);
            break;
        case 'showTyping':
            showTypingIndicator();
            break;
        case 'hideTyping':
            hideTypingIndicator();
            break;
        case 'startAIMessage':
            startAIMessage();
            break;
        case 'appendToAIMessage':
            appendToAIMessage(message.message);
            break;
        case 'completeAIMessage':
            completeAIMessage();
            break;
        case 'updateContext':
            console.log('Received context update:', message.contextItems);
            updateContextItems(message.contextItems);
            break;
        case 'fileBrowserUpdate':
            // Update current path display
            if (message.currentPath) {
                currentPath = message.currentPath;
                currentPathElement.textContent = message.currentPath;
            }
            
            // Update file list with received items
            updateFileList(message.items);
            break;
    }
});

// Add missing message handling functions
let currentAIMessage = null;

// Add a message to the chat
function addMessage(message, sender) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}-message`;
    
    if (sender === 'ai') {
        messageElement.innerHTML = formatText(message);
    } else {
        // For user messages, just use text content with pre-wrap
        messageElement.textContent = message;
    }
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Show typing indicator
function showTypingIndicator() {
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    typingIndicator.id = 'typing-indicator';
    typingIndicator.textContent = 'AI is typing...';
    messagesContainer.appendChild(typingIndicator);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Hide typing indicator
function hideTypingIndicator() {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

// Start a new AI message
function startAIMessage() {
    // Create a new message element
    currentAIMessage = document.createElement('div');
    currentAIMessage.className = 'message ai-message';
    messagesContainer.appendChild(currentAIMessage);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Append content to the current AI message
function appendToAIMessage(content) {
    if (currentAIMessage) {
        // Keep track of the accumulated message content
        if (!currentAIMessage.dataset.fullContent) {
            currentAIMessage.dataset.fullContent = '';
        }
        
        // Append the new content to the accumulated content
        currentAIMessage.dataset.fullContent += content;
        
        // Format the full content with markdown
        currentAIMessage.innerHTML = formatText(currentAIMessage.dataset.fullContent);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Complete the current AI message
function completeAIMessage() {
    currentAIMessage = null;
}