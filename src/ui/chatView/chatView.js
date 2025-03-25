const { Marked } = globalThis.marked;
const { markedHighlight } = globalThis.markedHighlight;

const vscode = acquireVsCodeApi();
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const imageUploadButton = document.getElementById('imageUploadBtn');
const fileInput = document.getElementById('fileInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreviews = document.getElementById('imagePreviews');
const contextItemsContainer = document.getElementById('contextItems');
const addContextBtn = document.getElementById('addContextBtn');
const clearContextBtn = document.getElementById('clearContextBtn');
const marked = new Marked(
    markedHighlight({
        emptyLangClass: 'hljs',
        langPrefix: 'hljs language-',
        highlight(code, lang, info) {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            return hljs.highlight(code, { language }).value;
        }
    })
);

let imageDataArray = [];

imageUploadButton.addEventListener('click', () => {
    fileInput.click(); // Trigger the file input dialog
});

// Handle file selection
fileInput.addEventListener('change', (event) => {
    if (event.target.files && event.target.files.length > 0) {
        const files = event.target.files;

        // Process each selected file
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // Read the file as data URL
            const reader = new FileReader();
            reader.onload = (e) => {
                // Create image data object
                const imageData = {
                    id: Date.now() + i, // Unique ID for each image
                    name: file.name,
                    size: `${Math.round(file.size / 1024)} KB`,
                    dataUrl: e.target.result
                };

                // Add to array
                imageDataArray.push(imageData);

                // Create and add preview
                addImagePreview(imageData);

                // Show the container if it's not already visible
                imagePreviewContainer.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }

        // Reset the file input so the same files can be selected again
        fileInput.value = '';
    }
});

function addImagePreview(imageData) {
    const previewItem = document.createElement('div');
    previewItem.className = 'image-preview-item';
    previewItem.dataset.id = imageData.id;

    const img = document.createElement('img');
    img.src = imageData.dataUrl;
    img.className = 'image-preview-thumbnail';
    img.alt = imageData.name;

    const info = document.createElement('div');
    info.className = 'image-preview-info';
    info.textContent = `${imageData.name} (${imageData.size})`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'image-preview-remove';
    removeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
    removeBtn.title = 'Remove Image';

    // Add remove functionality
    removeBtn.addEventListener('click', () => {
        // Remove from array
        imageDataArray = imageDataArray.filter(img => img.id !== imageData.id);

        // Remove from DOM
        previewItem.remove();

        // Hide container if no images left
        if (imageDataArray.length === 0) {
            imagePreviewContainer.style.display = 'none';
        }
    });

    previewItem.appendChild(img);
    previewItem.appendChild(info);
    previewItem.appendChild(removeBtn);

    imagePreviews.appendChild(previewItem);
}

function sendMessageWithImages() {
    const message = messageInput.value.trim();

    if (message || imageDataArray.length > 0) {
        // If there are images, add them to the chat
        if (imageDataArray.length > 0) {
            // Add each image to the chat
            imageDataArray.forEach(imageData => {
                addImageToChat(imageData, 'user');

                // Send image data to extension
                vscode.postMessage({
                    type: 'uploadImage',
                    imageData: imageData
                });
            });

            // Clear images
            imageDataArray = [];
            imagePreviews.innerHTML = '';
            imagePreviewContainer.style.display = 'none';
        }

        // If there's a text message, send it
        if (message) {
            vscode.postMessage({ type: 'sendMessage', message });
            messageInput.value = '';
            messageInput.style.height = 'auto';
        }
    }
}

// Event listeners
sendButton.addEventListener('click', sendMessageWithImages);

messageInput.addEventListener('input', function () {
    // Reset height to auto
    this.style.height = 'auto';

    // Count the number of newlines in the text
    const lineCount = (this.value.match(/\n/g) || []).length;

    // Calculate height based on content
    const lineHeight = 20; // Approximate line height in pixels
    const baseHeight = 20; // Height for a single line

    // If there's no text or just a single line, use the base height
    if (lineCount === 0) {
        this.style.height = baseHeight + 'px';
    } else {
        // For multiple lines, calculate based on line count
        const contentHeight = baseHeight + (lineHeight * lineCount);
        const newHeight = Math.min(contentHeight, 120); // Cap at max height
        this.style.height = newHeight + 'px';
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessageWithImages();
    }
});

function setFormatedText(ele, text) {
    // Process the text with marked
    const html = marked.parse(text);

    ele.innerHTML = html;

    // Process each code block to add copy buttons
    ele.querySelectorAll('pre code').forEach(codeBlock => {
        const pre = codeBlock.parentNode;

        // Create copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-code-button';
        copyButton.textContent = 'Copy';
        copyButton.addEventListener('click', () => {
            const code = codeBlock.textContent;
            let copied = false;
            navigator.clipboard.writeText(code).then(() => {
                if (copied) return;
                copyButton.textContent = 'Copied!';
                copied = true;
                setTimeout(() => {
                    copyButton.textContent = 'Copy';
                    copied = false;
                }, 2000);
            });
        });

        pre.appendChild(copyButton);
    });
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

        let iconClass = '';

        if (item.isDirectory) {
            iconClass = 'fa-solid fa-folder';
        } else if (item.isImage) {
            // Add special handling for image files
            iconClass = 'fa-solid fa-image';
        } else {
            // Get file extension
            const extension = item.name.split('.').pop().toLowerCase();

            // Use the same simplified approach as in updateFileList
            switch (extension) {
                case 'js':
                    iconClass = 'fa-brands fa-js';
                    break;
                case 'ts':
                    iconClass = 'fa-solid fa-code ts-file';
                    break;
                case 'html':
                    iconClass = 'fa-brands fa-html5';
                    break;
                case 'css':
                    iconClass = 'fa-brands fa-css3-alt';
                    break;
                case 'json':
                    iconClass = 'fa-solid fa-brackets-curly';
                    break;
                case 'md':
                    iconClass = 'fa-solid fa-file-lines md-file';
                    break;
                case 'py':
                    iconClass = 'fa-brands fa-python';
                    break;
                case 'csv':
                    iconClass = 'fa-solid fa-table csv-file';
                    break;
                case 'txt':
                    iconClass = 'fa-solid fa-file-lines';
                    break;
                default:
                    iconClass = 'fa-solid fa-file';
            }
        }

        html += `
            <div class="context-item" data-path="${item.path}">
                <span class="context-item-icon ${iconClass}"></span>
                <span class="context-item-name" title="${item.path}">${item.name}</span>
                <span class="context-item-remove fa-solid fa-xmark" title="Remove from context"></span>
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

function updateFileList(items) {
    fileListElement.innerHTML = '';

    items.forEach(item => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.path = item.path;
        fileItem.dataset.isDirectory = item.isDirectory;
        fileItem.dataset.isImage = item.isImage || false;

        if (selectedItems.has(item.path)) {
            fileItem.classList.add('selected');
        }

        const icon = document.createElement('span');

        // Set appropriate icon based on file type
        if (item.isDirectory) {
            icon.className = 'file-item-icon fa-solid fa-folder';
        } else if (item.isImage) {
            icon.className = 'file-item-icon fa-solid fa-image';
        } else {
            // Get file extension
            const extension = item.name.split('.').pop().toLowerCase();

            // Use a simpler approach with fewer icon types but more reliable
            switch (extension) {
                case 'jpg':
                case 'jpeg':
                case 'png':
                case 'gif':
                case 'bmp':
                case 'webp':
                    icon.className = 'file-item-icon fa-solid fa-image';
                    break;
                case 'js':
                    icon.className = 'file-item-icon fa-brands fa-js';
                    break;
                case 'ts':
                    icon.className = 'file-item-icon fa-solid fa-code ts-file';
                    break;
                case 'html':
                    icon.className = 'file-item-icon fa-brands fa-html5';
                    break;
                case 'css':
                    icon.className = 'file-item-icon fa-brands fa-css3-alt';
                    break;
                case 'json':
                    icon.className = 'file-item-icon fa-solid fa-brackets-curly';
                    break;
                case 'md':
                    icon.className = 'file-item-icon fa-solid fa-file-lines md-file';
                    break;
                case 'py':
                    icon.className = 'file-item-icon fa-brands fa-python';
                    break;
                case 'csv':
                    icon.className = 'file-item-icon fa-solid fa-table csv-file';
                    break;
                case 'txt':
                    icon.className = 'file-item-icon fa-solid fa-file-lines';
                    break;
                case 'json':
                    icon.className = 'file-item-icon fa-solid fa-brackets-curly';
                    break;
                default:
                    icon.className = 'file-item-icon fa-solid fa-file';
            }
        }

        const name = document.createElement('span');
        name.textContent = item.name;

        fileItem.appendChild(icon);
        fileItem.appendChild(name);

        // Add image preview for image files
        if (item.isImage) {
            fileItem.classList.add('image-file');

            // Create preview element that will be shown on hover
            const preview = document.createElement('div');
            preview.className = 'image-preview';

            // Create image element with VS Code URI
            const img = document.createElement('img');
            img.src = `vscode-resource:${item.path}`;
            img.alt = item.name;

            preview.appendChild(img);

            // Show preview on hover
            fileItem.addEventListener('mouseenter', () => {
                document.body.appendChild(preview);

                // Position preview next to the item
                const rect = fileItem.getBoundingClientRect();
                preview.style.left = `${rect.right + 10}px`;
                preview.style.top = `${rect.top}px`;
            });

            fileItem.addEventListener('mouseleave', () => {
                if (document.body.contains(preview)) {
                    document.body.removeChild(preview);
                }
            });
        }

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

// File browser elements
const fileBrowserDialog = document.getElementById('fileBrowserDialog');
const currentPathElement = document.getElementById('currentPath');
const fileListElement = document.getElementById('fileList');
const selectedItemsCountElement = document.getElementById('selectedItemsCount');
const upDirBtn = document.getElementById('upDirBtn');
const homeBtn = document.getElementById('homeBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const closeBrowserBtn = document.getElementById('closeBrowserBtn');
const cancelSelectBtn = document.getElementById('cancelSelectBtn');
const confirmSelectBtn = document.getElementById('confirmSelectBtn');

// Create modal overlay
const modalOverlay = document.createElement('div');
modalOverlay.className = 'modal-overlay';
document.body.appendChild(modalOverlay);

// Selected items set
const selectedItems = new Set();

// Show file browser
function showFileBrowser() {
    // Clear any previously selected items
    selectedItems.clear();
    updateSelectedItemsCount();

    // Show the dialog and overlay
    fileBrowserDialog.classList.add('active');
    modalOverlay.classList.add('active');

    // Request initial directory listing (workspace root)
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: ''  // Empty path means get workspace root
    });
}

// Hide file browser
function hideFileBrowser() {
    fileBrowserDialog.classList.remove('active');
    modalOverlay.classList.remove('active');
    selectedItems.clear();
}

// Update selected items count
function updateSelectedItemsCount() {
    selectedItemsCountElement.textContent = selectedItems.size.toString();
}

// Navigate to directory
function navigateToDirectory(dirPath) {
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: dirPath
    });
}

// Navigate up one directory
function navigateUp() {
    const currentPath = currentPathElement.textContent;
    if (currentPath) {
        const parentPath = path.dirname(currentPath);
        navigateToDirectory(parentPath);
    }
}

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
selectAllBtn.addEventListener('click', selectAllItems);
closeBrowserBtn.addEventListener('click', hideFileBrowser);
cancelSelectBtn.addEventListener('click', hideFileBrowser);
confirmSelectBtn.addEventListener('click', () => {
    // Convert Set to Array for sending
    const selectedPaths = Array.from(selectedItems);

    // Send selected paths to extension
    vscode.postMessage({
        type: 'contextAction',
        action: 'addCustom',
        paths: selectedPaths
    });

    // Hide the dialog
    hideFileBrowser();
});

// Also close when clicking on the overlay
modalOverlay.addEventListener('click', hideFileBrowser);

// Function to select all items in the current directory
function selectAllItems() {
    // Get all file items in the current directory
    const fileItems = document.querySelectorAll('.file-item');

    fileItems.forEach(item => {
        const path = item.dataset.path;

        // Add to selected items set
        selectedItems.add(path);

        // Add selected class
        item.classList.add('selected');
    });

    // Update the count
    updateSelectedItemsCount();
}

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

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    console.log('Received message from extension:', message);

    switch (message.type) {
        case 'updateContext':
            updateContextItems(message.contextItems);

            if (message.imageItems) {
                updateImageContextItems(message.imageItems);
            }
            break;
        case 'addMessage':
            // Fix the parameter order and log for debugging
            console.log('Adding message:', message.role, message.content);
            addMessage(message.content, message.role);
            break;
        case 'typingIndicator':
            setTypingIndicator(message.isTyping);
            break;
        case 'fileBrowserUpdate':
            updateFileList(message.items);
            currentPathElement.textContent = message.currentPath;
            break;
        case 'startAIMessage':
            // Create a new message element with the given ID
            const aiMessageDiv = document.createElement('div');
            aiMessageDiv.id = message.messageId;
            aiMessageDiv.className = 'message ai-message';
            aiMessageDiv.innerHTML = ''; // Start empty
            messagesContainer.appendChild(aiMessageDiv);
            // messagesContainer.scrollTop = messagesContainer.scrollHeight;
            break;

        case 'appendToAIMessage':
            const currentAiMessage = document.getElementById(message.messageId);
            if (currentAiMessage) {
                // We need to maintain the full markdown text to render it properly

                // If this is the first chunk, initialize the data attribute
                if (!currentAiMessage.hasAttribute('data-markdown-content')) {
                    currentAiMessage.setAttribute('data-markdown-content', '');
                }

                // Append the new chunk to our stored markdown content
                const currentMarkdown = currentAiMessage.getAttribute('data-markdown-content');
                const updatedMarkdown = currentMarkdown + message.content;
                currentAiMessage.setAttribute('data-markdown-content', updatedMarkdown);

                // Render the complete markdown content
                setFormatedText(currentAiMessage, updatedMarkdown);

                // Scroll to the bottom
                // messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
            break;

        case 'finalizeAIMessage':
            // Any final processing for the message (if needed)
            const finalMessage = document.getElementById(message.messageId);
            if (finalMessage) {
                // Add any final classes or processing
                finalMessage.classList.add('complete');
            }
            break;

        case 'imageUploaded':
            // Handle image uploaded from extension
            if (message.imageData) {
                addImageToChat(message.imageData, 'user');
            }
            break;
    }
});

function updateImageContextItems(items) {
    console.log('Updating image context items in UI:', items);
    const imageContextContainer = document.getElementById('imageContextItems');
    
    if (!imageContextContainer) {
        console.error('Image context container not found');
        return;
    }

    if (!items || items.length === 0) {
        imageContextContainer.innerHTML = '<div class="empty-context">No images in context</div>';
        return;
    }

    // Create a Set to track unique paths and avoid duplicates
    const uniquePaths = new Set();
    let html = '';

    for (const item of items) {
        // Skip if we've already added this path or if it's not an image
        if (uniquePaths.has(item.path) || !item.isImage) {
            continue;
        }

        uniquePaths.add(item.path);

        html += `
            <div class="context-item image-context-item" data-path="${item.path}">
                <span class="context-item-icon fa-solid fa-image"></span>
                <span class="context-item-name" title="${item.path}">${item.name}</span>
                <span class="context-item-remove fa-solid fa-xmark" title="Remove from context"></span>
            </div>
        `;
    }

    imageContextContainer.innerHTML = html;

    // Add event listeners to remove buttons
    imageContextContainer.querySelectorAll('.context-item-remove').forEach(button => {
        button.addEventListener('click', (e) => {
            const item = e.target.closest('.context-item');
            const path = item.dataset.path;
            vscode.postMessage({
                type: 'contextAction',
                action: 'removeImage',
                path: path
            });
            e.stopPropagation();
        });
    });
}

function addImageToChat(imageData, role) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${role}-message`;

    // Create image element
    const img = document.createElement('img');
    img.src = imageData.dataUrl;
    img.alt = imageData.name || 'Uploaded image';
    img.className = 'chat-image';
    img.title = imageData.name || 'Uploaded image';

    // Add click to expand functionality
    img.addEventListener('click', () => {
        showExpandedImage(imageData.dataUrl, imageData.name);
    });

    // Add image info
    const imageInfo = document.createElement('div');
    imageInfo.className = 'image-info';
    imageInfo.textContent = `Image: ${imageData.name || 'Uploaded image'} (${imageData.size || 'unknown size'})`;

    messageElement.appendChild(imageInfo);
    messageElement.appendChild(img);

    messagesContainer.appendChild(messageElement);
    // messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showExpandedImage(src, title) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';

    // Create image container
    const container = document.createElement('div');
    container.className = 'expanded-image-container';

    // Create image
    const img = document.createElement('img');
    img.src = src;
    img.alt = title || 'Expanded image';
    img.className = 'expanded-image';

    // Create title
    if (title) {
        const titleElement = document.createElement('div');
        titleElement.className = 'expanded-image-title';
        titleElement.textContent = title;
        container.appendChild(titleElement);
    }

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'expanded-image-close';
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });

    // Add elements to container
    container.appendChild(closeButton);
    container.appendChild(img);
    overlay.appendChild(container);

    // Add click outside to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });

    // Add to body
    document.body.appendChild(overlay);
}

// Add a message to the chat - ensure this is the only definition of this function
function addMessage(content, role) {
    console.log(`Adding ${role} message to chat`);
    const messageElement = document.createElement('div');

    // Fix the class name to match both 'user' and 'assistant' roles
    messageElement.className = `message ${role}-message`;

    if (role === 'assistant' || role === 'ai') {
        // Handle both 'assistant' and 'ai' role names
        setFormatedText(currentAiMessage, updatedMarkdown);
    } else {
        // For user messages, just use text content with pre-wrap
        messageElement.textContent = content;
    }

    messagesContainer.appendChild(messageElement);
    // messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Show/hide typing indicator - ensure this is the only definition
function setTypingIndicator(isTyping) {
    // Remove existing indicator if any
    const existingIndicator = document.getElementById('typing-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    if (isTyping) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.id = 'typing-indicator';
        typingIndicator.textContent = 'AI is typing...';
        messagesContainer.appendChild(typingIndicator);
        // messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}
