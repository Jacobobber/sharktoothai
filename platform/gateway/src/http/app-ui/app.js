const chatList = document.getElementById("chatList");
const messageList = document.getElementById("messageList");
const chatTitle = document.getElementById("chatTitle");
const chatSubtitle = document.getElementById("chatSubtitle");
const scopeStatus = document.getElementById("scopeStatus");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");
const logoutBtn = document.getElementById("logoutBtn");
const adminLink = document.getElementById("adminLink");
const accountRole = document.getElementById("accountRole");
const scopePanel = document.getElementById("scopePanel");
const scopeValue = document.getElementById("scopeValue");

let currentRole = null;
let currentConversationId = null;
let scopeMode = "tenant";
let scopeData = { tenants: [], groups: [] };

const apiFetch = async (path, options = {}) => {
  const headers = { ...(options.headers ?? {}) };
  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, { ...options, headers, credentials: "include", cache: "no-store" });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let data = {};
  if (text && contentType.includes("application/json")) {
    data = JSON.parse(text);
  }
  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = "/login?redirect=/app";
      return {};
    }
    const message = data?.message || text || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
};

const setEmptyState = () => {
  messageList.innerHTML = "";
  const state = document.createElement("div");
  state.className = "empty-state";
  state.textContent = "Start a new conversation to search repair orders.";
  messageList.appendChild(state);
};

const renderConversations = (conversations) => {
  chatList.innerHTML = "";
  conversations.forEach((convo) => {
    const item = document.createElement("div");
    item.className = "chat-item";
    if (convo.conversation_id === currentConversationId) {
      item.classList.add("active");
    }
    const title = document.createElement("h4");
    title.textContent = convo.title || "New chat";
    const meta = document.createElement("span");
    meta.textContent = new Date(convo.last_message_at).toLocaleString();
    item.appendChild(title);
    item.appendChild(meta);
    item.addEventListener("click", () => {
      selectConversation(convo.conversation_id, convo.title);
    });
    chatList.appendChild(item);
  });
};

const renderMessages = (messages) => {
  messageList.innerHTML = "";
  if (!messages.length) {
    setEmptyState();
    return;
  }
  messages.forEach((msg) => appendMessage(msg.role, msg.content, msg.sources));
};

const appendMessage = (role, content, sources) => {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role.toLowerCase()}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  wrapper.appendChild(bubble);

  if (sources && sources.length) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const labels = sources
      .map((source) => (source.ro_number ? `RO ${source.ro_number}` : "RO"))
      .filter(Boolean);
    meta.textContent = labels.length ? `Sources: ${labels.join(", ")}` : "Sources available";
    bubble.appendChild(meta);
  }

  messageList.appendChild(wrapper);
  messageList.scrollTop = messageList.scrollHeight;
};

const getScopeHeaders = () => {
  if (currentRole !== "DEVELOPER") return {};
  const value = scopeValue.value;
  if (!value) return {};
  if (scopeMode === "group") {
    return { "x-scope-group-id": value };
  }
  return { "x-scope-tenant-id": value };
};

const updateScopeStatus = () => {
  if (currentRole !== "DEVELOPER") {
    scopeStatus.textContent = "Tenant scope";
    return;
  }
  const value = scopeValue.value;
  if (!value) {
    scopeStatus.textContent =
      scopeMode === "group" ? "Group scope (select a group)" : "Tenant scope";
    return;
  }
  const collection = scopeMode === "group" ? scopeData.groups : scopeData.tenants;
  const match = collection.find((item) => item.id === value);
  const label = match ? match.label : value;
  scopeStatus.textContent = `${scopeMode === "group" ? "Group" : "Tenant"}: ${label}`;
};

const loadConversations = async () => {
  const data = await apiFetch("/chat/conversations?limit=100");
  const conversations = data.data || [];
  renderConversations(conversations);
  if (!currentConversationId && conversations[0]) {
    await selectConversation(conversations[0].conversation_id, conversations[0].title);
  }
};

const selectConversation = async (conversationId, title) => {
  currentConversationId = conversationId;
  chatTitle.textContent = title || "Conversation";
  const data = await apiFetch(`/chat/conversations/${conversationId}/messages`);
  renderMessages(data.data || []);
  await loadConversations();
};

const createConversation = async () => {
  const data = await apiFetch("/chat/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "New chat" })
  });
  const convo = data.data;
  if (convo?.conversation_id) {
    currentConversationId = convo.conversation_id;
    chatTitle.textContent = convo.title || "New chat";
    await loadConversations();
    setEmptyState();
  }
};

const sendMessage = async (message) => {
  appendMessage("USER", message);
  chatInput.value = "";
  chatInput.focus();

  const headers = getScopeHeaders();
  const payload = {
    message,
    conversation_id: currentConversationId || undefined
  };
  const response = await apiFetch("/chat/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  if (!currentConversationId && response.conversation_id) {
    currentConversationId = response.conversation_id;
  }
  appendMessage("ASSISTANT", response.answer || "No response.", response.sources);
  await loadConversations();
};

const loadScopeOptions = async () => {
  if (currentRole !== "DEVELOPER") return;
  const [tenantRes, groupRes] = await Promise.all([
    apiFetch("/admin/api/tenants"),
    apiFetch("/admin/api/groups")
  ]);
  scopeData.tenants = (tenantRes.data || []).map((tenant) => ({
    id: tenant.tenant_id,
    label: `${tenant.name} (${tenant.tenant_id.slice(0, 8)})`
  }));
  scopeData.groups = (groupRes.data || []).map((group) => ({
    id: group.group_id,
    label: `${group.name} (${group.group_id.slice(0, 8)})`
  }));
  renderScopeOptions();
};

const renderScopeOptions = () => {
  scopeValue.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = scopeMode === "group" ? "Select group" : "Use my tenant";
  scopeValue.appendChild(defaultOpt);

  const list = scopeMode === "group" ? scopeData.groups : scopeData.tenants;
  list.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.label;
    scopeValue.appendChild(opt);
  });
  updateScopeStatus();
};

document.querySelectorAll('input[name="scopeMode"]').forEach((radio) => {
  radio.addEventListener("change", (event) => {
    scopeMode = event.target.value;
    renderScopeOptions();
  });
});

scopeValue.addEventListener("change", () => {
  updateScopeStatus();
});

const handleSubmit = async () => {
  const message = chatInput.value.trim();
  if (!message) return;
  try {
    await sendMessage(message);
  } catch (err) {
    appendMessage("ASSISTANT", err.message || "Failed to send.");
  }
};

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  event.stopPropagation();
  void handleSubmit();
});
sendBtn.addEventListener("click", () => {
  void handleSubmit();
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void handleSubmit();
  }
});

newChatBtn.addEventListener("click", async () => {
  await createConversation();
});

logoutBtn.addEventListener("click", async () => {
  await apiFetch("/auth/logout", { method: "POST" });
  window.location.href = "/login?redirect=/app";
});

const bootstrap = async () => {
  try {
    const me = await apiFetch("/auth/me");
    currentRole = me.role;
    accountRole.textContent = `${me.role} • ${me.tenant_id.slice(0, 8)}`;
    if (me.role !== "USER") {
      adminLink.classList.remove("hidden");
    }
    if (me.role === "DEVELOPER") {
      scopePanel.classList.remove("hidden");
      try {
        await loadScopeOptions();
      } catch (err) {
        scopeStatus.textContent = "Tenant scope";
      }
    }
    await loadConversations();
    if (!currentConversationId) {
      setEmptyState();
    }
  } catch (err) {
    setEmptyState();
  }
};

bootstrap();
