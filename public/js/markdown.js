// =====================================================
// Markdown — lightweight renderer, toolbar, smart paste
// =====================================================

function renderMarkdown(text) {
  if (!text) return '';
  var html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, function(m, code) {
    return '<pre style="background:#F3F4F6;border-radius:6px;padding:8px 12px;font-size:12px;font-family:monospace;overflow-x:auto;margin:6px 0;">' + code.trim() + '</pre>';
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#F3F4F6;padding:1px 5px;border-radius:3px;font-size:11px;font-family:monospace;">$1</code>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<strong style="font-size:13px;display:block;margin:8px 0 4px;">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong style="font-size:14px;display:block;margin:8px 0 4px;">$1</strong>');
  html = html.replace(/^# (.+)$/gm, '<strong style="font-size:15px;display:block;margin:10px 0 4px;">$1</strong>');
  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--blue);text-decoration:underline;">$1</a>');
  // Bare URLs
  html = html.replace(/(?<!href="|">)(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:var(--blue);text-decoration:underline;">$1</a>');
  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li style="margin-left:16px;list-style:disc;">$1</li>');
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style:decimal;">$1</li>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/<br><(pre|strong|li)/g, '<$1');
  html = html.replace(/<\/(pre|li)><br>/g, '</$1>');
  return html;
}

function insertMarkdownSyntax(textareaId, before, after) {
  var ta = document.getElementById(textareaId);
  if (!ta) return;
  ta.focus();
  var start = ta.selectionStart;
  var end = ta.selectionEnd;
  var selected = ta.value.substring(start, end);
  var replacement = before + (selected || 'text') + (after || '');
  ta.value = ta.value.substring(0, start) + replacement + ta.value.substring(end);
  ta.selectionStart = start + before.length;
  ta.selectionEnd = start + before.length + (selected || 'text').length;
}

function renderMarkdownToolbar(textareaId) {
  var s = 'background:none;border:1px solid var(--border);color:var(--text-secondary);padding:2px 7px;border-radius:4px;font-size:12px;cursor:pointer;font-family:Poppins,sans-serif;line-height:1.4;transition:all 0.1s;';
  return '<div style="display:flex;gap:3px;margin-bottom:4px;flex-wrap:wrap;">'
    + '<button style="' + s + 'font-weight:700;" onclick="event.preventDefault();insertMarkdownSyntax(\'' + textareaId + '\',\'**\',\'**\')" title="Bold">B</button>'
    + '<button style="' + s + 'font-style:italic;" onclick="event.preventDefault();insertMarkdownSyntax(\'' + textareaId + '\',\'*\',\'*\')" title="Italic"><em>I</em></button>'
    + '<button style="' + s + '" onclick="event.preventDefault();insertMarkdownSyntax(\'' + textareaId + '\',\'~~\',\'~~\')" title="Strikethrough"><del>S</del></button>'
    + '<button style="' + s + '" onclick="event.preventDefault();insertMarkdownSyntax(\'' + textareaId + '\',\'[\',\'](url)\')" title="Link">&#128279;</button>'
    + '<button style="' + s + '" onclick="event.preventDefault();insertMarkdownSyntax(\'' + textareaId + '\',\'# \',\'\')" title="Heading">H</button>'
    + '<button style="' + s + '" onclick="event.preventDefault();insertMarkdownSyntax(\'' + textareaId + '\',\'- \',\'\')" title="List">&bull;</button>'
    + '<button style="' + s + 'font-family:monospace;" onclick="event.preventDefault();insertMarkdownSyntax(\'' + textareaId + '\',\'`\',\'`\')" title="Code">&lt;/&gt;</button>'
    + '</div>';
}

function setupSmartLinkPaste(textarea) {
  if (textarea._smartPasteSetup) return;
  textarea._smartPasteSetup = true;
  textarea.addEventListener('paste', function(e) {
    var clipText = (e.clipboardData || window.clipboardData).getData('text');
    if (!clipText) return;
    if (!/^https?:\/\/\S+$/.test(clipText.trim())) return;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    if (start === end) return;
    e.preventDefault();
    var selected = textarea.value.substring(start, end);
    var replacement = '[' + selected + '](' + clipText.trim() + ')';
    textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + replacement.length;
  });
}
