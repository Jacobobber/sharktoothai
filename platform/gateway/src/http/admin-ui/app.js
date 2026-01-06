const sections = document.querySelectorAll(".section");
const navButtons = document.querySelectorAll("nav button");
const logoutBtn = document.getElementById("logoutBtn");
const tenantSelector = document.getElementById("tenantSelector");
const tenantPicker = document.getElementById("tenantPicker");

const tenantTable = document.getElementById("tenantTable");
const auditTable = document.getElementById("auditTable");
const groupTable = document.getElementById("groupTable");
const userTable = document.getElementById("userTable");
const chatTable = document.getElementById("chatTable");
const chatMessages = document.getElementById("chatMessages");

const tenantSummary = document.getElementById("tenantSummary");
const userSummary = document.getElementById("userSummary");
const ingestSummary = document.getElementById("ingestSummary");
const auditSummary = document.getElementById("auditSummary");
const chatSummary = document.getElementById("chatSummary");

const ingestBtn = document.getElementById("ingestBtn");
const ingestFiles = document.getElementById("ingestFiles");
const ingestDelay = document.getElementById("ingestDelay");
const ingestLog = document.getElementById("ingestLog");

const auditAction = document.getElementById("auditAction");
const auditRefresh = document.getElementById("auditRefresh");
const createGroupBtn = document.getElementById("createGroup");
const groupNameInput = document.getElementById("groupName");
const createUserBtn = document.getElementById("createUser");
const userEmailInput = document.getElementById("userEmail");
const userPasswordInput = document.getElementById("userPassword");
const userRoleInput = document.getElementById("userRole");
const userTenantInput = document.getElementById("userTenant");
const createTenantBtn = document.getElementById("createTenant");
const tenantNameInput = document.getElementById("tenantName");
const tenantGroupInput = document.getElementById("tenantGroup");
const createTenantRow = document.getElementById("createTenantRow");
const createGroupRow = document.getElementById("createGroupRow");
const tenantCreateStatus = document.getElementById("tenantCreateStatus");

let currentRole = null;
const tenantStorageKey = "adminTenantId";

const SECTION_META = {
  dashboard: "System overview and recent activity.",
  tenants: "Tenant configuration and flags.",
  groups: "Dealer group roster and creation.",
  users: "Create and manage users per tenant.",
  chats: "Customer chat history within scope.",
  ingest: "Upload synthetic or production XML.",
  audit: "Security and workflow audit trail."
};

const setActiveSection = (id) => {
  sections.forEach((section) => {
    section.classList.toggle("active", section.id === id);
  });
  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === id);
  });
  const title = document.getElementById("sectionTitle");
  const subtitle = document.getElementById("sectionSubtitle");
  title.textContent = id === "tenants" ? "Tenant" : id.charAt(0).toUpperCase() + id.slice(1);
  subtitle.textContent = SECTION_META[id] ?? "";
  if (id === "dashboard") refreshDashboard();
  if (id === "tenants") loadTenants().catch(() => {});
  if (id === "groups") loadGroups().catch(() => {});
  if (id === "users") loadUsers().catch(() => {});
  if (id === "chats") loadChats().catch(() => {});
  if (id === "audit") loadAudit().catch(() => {});
};

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => setActiveSection(btn.dataset.section));
});

tenantSelector?.addEventListener("change", () => {
  localStorage.setItem(tenantStorageKey, tenantSelector.value);
  refreshDashboard().catch(() => {});
});

document.querySelectorAll(".dashboard-card").forEach((card) => {
  card.addEventListener("click", () => {
    const target = card.dataset.target;
    if (target) setActiveSection(target);
  });
});

const apiFetch = async (path, options = {}) => {
  const headers = { ...(options.headers ?? {}) };
  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }
  if (currentRole === "DEVELOPER") {
    const tenantId = tenantSelector?.value?.trim();
    if (tenantId) {
      headers["x-tenant-id"] = tenantId;
    }
  }
  const response = await fetch(path, { ...options, headers, cache: "no-store", credentials: "include" });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let data = {};
  if (text && contentType.includes("application/json")) {
    data = JSON.parse(text);
  }
  if (!response.ok) {
    const message = data?.message || text || `Request failed (${response.status})`;
    if (response.status === 401) {
      window.location.href = "/login?redirect=/admin";
    }
    throw new Error(message);
  }
  return data;
};

const disableSection = (id) => {
  const section = document.getElementById(id);
  const button = Array.from(navButtons).find((btn) => btn.dataset.section === id);
  const card = document.querySelector(`.dashboard-card[data-target="${id}"]`);
  if (section) section.classList.remove("active");
  if (section) section.style.display = "none";
  if (button) button.style.display = "none";
  if (card) card.style.display = "none";
};

logoutBtn.addEventListener("click", () => {
  fetch("/auth/logout", { method: "POST", credentials: "include" }).finally(() => {
    window.location.href = "/login?redirect=/admin";
  });
});

const loadTenants = async () => {
  const data = await apiFetch("/admin/api/tenants");
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Tenant data unavailable. Check admin token.");
  }
  tenantTable.innerHTML = "";
  if (currentRole === "DEVELOPER" && tenantSelector) {
    const saved = localStorage.getItem(tenantStorageKey) ?? "";
    tenantSelector.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "No tenant selected";
    tenantSelector.appendChild(blank);
    data.data.forEach((tenant) => {
      const option = document.createElement("option");
      option.value = tenant.tenant_id;
      option.textContent = `${tenant.name} (${tenant.tenant_id})`;
      tenantSelector.appendChild(option);
    });
    tenantSelector.value = data.data.find((tenant) => tenant.tenant_id === saved)?.tenant_id ?? "";
  }
  data.data.forEach((tenant) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${tenant.tenant_id}</td>
      <td>${tenant.name}</td>
      <td><input type="checkbox" data-field="is_active" ${tenant.is_active ? "checked" : ""}></td>
      <td><input type="checkbox" data-field="pii_enabled" ${tenant.pii_enabled ? "checked" : ""}></td>
      <td><input type="text" data-field="group_id" value="${tenant.group_name ?? ""}" placeholder="Group name"></td>
      <td><button data-save-tenant="${tenant.tenant_id}">Save</button></td>
    `;
    const saveBtn = row.querySelector("button");
    saveBtn?.addEventListener("click", async () => {
      const isActive = row.querySelector('input[data-field="is_active"]').checked;
      const piiEnabled = row.querySelector('input[data-field="pii_enabled"]').checked;
      const groupName = row.querySelector('input[data-field="group_id"]').value.trim();
      try {
        await apiFetch(`/admin/api/tenants/${tenant.tenant_id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_active: isActive, pii_enabled: piiEnabled })
        });
        await apiFetch(`/admin/api/tenants/${tenant.tenant_id}/group`, {
          method: "PATCH",
          body: JSON.stringify({ group_id: groupName || null })
        });
        await loadTenants();
      } catch (err) {
        alert(err.message);
      }
    });
    tenantTable.appendChild(row);
  });
  const active = data.data[0];
  if (active) {
    tenantSummary.textContent = `${active.name} (${active.tenant_id}) • ${
      active.is_active ? "Active" : "Inactive"
    } • PII ${active.pii_enabled ? "Enabled" : "Disabled"}`;
  } else {
    tenantSummary.textContent = "No tenants available.";
  }
};

const loadAudit = async () => {
  const action = auditAction.value.trim();
  const params = new URLSearchParams({ limit: "25" });
  if (action) params.set("action", action);
  const data = await apiFetch(`/audit?${params.toString()}`);
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Audit data unavailable. Check admin token.");
  }
  auditTable.innerHTML = "";
  data.data.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(row.created_at).toLocaleString()}</td>
      <td>${row.action}</td>
      <td>${row.object_type}</td>
      <td>${row.user_id ?? ""}</td>
    `;
    auditTable.appendChild(tr);
  });
  auditSummary.textContent = `${data.data.length} recent audit entries.`;
};


const loadIngestSummary = async () => {
  const params = new URLSearchParams({ limit: "100" });
  const data = await apiFetch(`/audit?${params.toString()}`);
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Audit data unavailable.");
  }
  const ingestEvents = data.data.filter((row) =>
    ["INGEST_COMPLETE", "INGEST_FAILED"].includes(row.action)
  );
  const ok = ingestEvents.filter((row) => row.action === "INGEST_COMPLETE").length;
  const failed = ingestEvents.filter((row) => row.action === "INGEST_FAILED").length;
  ingestSummary.textContent = `${ok} ingested, ${failed} failed (last 100 audits).`;
};

const refreshDashboard = async () => {
  try {
    await Promise.all([loadTenants(), loadUsers(), loadIngestSummary(), loadChatSummary(), loadAudit()]);
  } catch {
    // Keep existing values if refresh fails.
  }
};

const loadChatSummary = async () => {
  const data = await apiFetch("/admin/api/chats?limit=50");
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Chat data unavailable.");
  }
  chatSummary.textContent = `${data.data.length} recent conversations.`;
};

const loadGroups = async () => {
  const data = await apiFetch("/admin/api/groups");
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Group data unavailable.");
  }
  groupTable.innerHTML = "";
  data.data.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.group_id}</td>
      <td>${row.name}</td>
      <td>${new Date(row.created_at).toLocaleString()}</td>
    `;
    groupTable.appendChild(tr);
  });
};

const loadUsers = async () => {
  const data = await apiFetch("/admin/api/users");
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("User data unavailable.");
  }
  if (currentRole === "DEVELOPER") {
    const tenantId = tenantSelector?.value?.trim();
    userSummary.textContent = tenantId
      ? `${data.data.length} users (selected tenant).`
      : `${data.data.length} users (no tenant selected).`;
  } else {
    userSummary.textContent = `${data.data.length} users (current tenant).`;
  }
  userTable.innerHTML = "";
  data.data.forEach((row) => {
    const tr = document.createElement("tr");
    const allowedRoles = getAllowedRolesForCreator();
    tr.innerHTML = `
      <td>${row.user_id}</td>
      <td>${row.email}</td>
      <td>
        <select data-user="${row.user_id}">
          ${allowedRoles
            .map(
              (role) =>
                `<option value="${role}" ${row.role === role ? "selected" : ""}>${role}</option>`
            )
            .join("")}
        </select>
      </td>
      <td><input type="checkbox" data-active="${row.user_id}" ${row.is_active ? "checked" : ""}></td>
      <td><button data-save-user="${row.user_id}">Save</button></td>
      <td><button class="danger" data-delete-user="${row.user_id}">Delete</button></td>
    `;
    const select = tr.querySelector("select");
    const saveBtn = tr.querySelector("button");
    const deleteBtn = tr.querySelector("button.danger");
    if (!allowedRoles.includes(row.role)) {
      if (select) select.disabled = true;
      if (saveBtn) saveBtn.disabled = true;
      if (deleteBtn) deleteBtn.disabled = true;
      tr.title = "Insufficient role to modify this user.";
    }
    saveBtn?.addEventListener("click", async () => {
      const role = tr.querySelector("select").value;
      const active = tr.querySelector("input").checked;
      try {
        await apiFetch(`/admin/api/users/${row.user_id}`, {
          method: "PATCH",
          body: JSON.stringify({ role, is_active: active })
        });
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
    deleteBtn?.addEventListener("click", async () => {
      if (!confirm(`Delete user ${row.email}?`)) return;
      try {
        await apiFetch(`/admin/api/users/${row.user_id}`, {
          method: "DELETE"
        });
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
    userTable.appendChild(tr);
  });
};

const loadChats = async () => {
  const data = await apiFetch("/admin/api/chats?limit=100");
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Chat data unavailable.");
  }
  chatTable.innerHTML = "";
  data.data.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.title}</td>
      <td>${row.user_email}</td>
      <td>${row.tenant_name}</td>
      <td>${new Date(row.last_message_at).toLocaleString()}</td>
      <td><button data-chat="${row.conversation_id}">View</button></td>
    `;
    const viewBtn = tr.querySelector("button");
    viewBtn?.addEventListener("click", async () => {
      await loadChatMessages(row.conversation_id);
    });
    chatTable.appendChild(tr);
  });
  chatSummary.textContent = `${data.data.length} recent conversations.`;
};

const loadChatMessages = async (conversationId) => {
  const data = await apiFetch(`/admin/api/chats/${conversationId}/messages`);
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Chat message data unavailable.");
  }
  chatMessages.innerHTML = "";
  data.data.forEach((row) => {
    const line = document.createElement("div");
    line.textContent = `${row.role}: ${row.content}`;
    chatMessages.appendChild(line);
  });
  if (!data.data.length) {
    chatMessages.textContent = "No messages yet.";
  }
};

const appendLog = (message) => {
  const line = document.createElement("div");
  line.textContent = message;
  ingestLog.appendChild(line);
  ingestLog.scrollTop = ingestLog.scrollHeight;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

ingestBtn.addEventListener("click", async () => {
  ingestLog.innerHTML = "";
  const files = Array.from(ingestFiles.files ?? []);
  if (!files.length) {
    appendLog("Select XML files first.");
    return;
  }
  const delayMs = Number(ingestDelay.value || 0);
  for (const file of files) {
    const filename = file.name;
    const roNumber = filename.replace(/\.xml$/i, "");
    const contentBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const base64 = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("File read failed"));
      reader.readAsDataURL(file);
    });
    try {
      await apiFetch("/workloads/ro/ingest", {
        method: "POST",
        body: JSON.stringify({
          filename,
          content_base64: contentBase64,
          ro_number: roNumber
        })
      });
      appendLog(`Ingested ${filename}`);
    } catch (err) {
      appendLog(`Failed ${filename}: ${err.message}`);
    }
    if (delayMs > 0) await delay(delayMs);
  }
});

auditRefresh.addEventListener("click", () => {
  loadAudit().catch((err) => {
    auditSummary.textContent = err.message;
  });
});

createGroupBtn.addEventListener("click", async () => {
  const name = groupNameInput.value.trim();
  if (!name) return;
  try {
    await apiFetch("/admin/api/groups", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    groupNameInput.value = "";
    await loadGroups();
    await loadTenants();
    await refreshDashboard();
  } catch (err) {
    alert(err.message);
  }
});

createUserBtn.addEventListener("click", async () => {
  const email = userEmailInput.value.trim();
  const password = userPasswordInput.value.trim();
  const role = userRoleInput.value;
  const tenantValue = userTenantInput.value.trim();
  if (!email || !password || (role !== "DEVELOPER" && !tenantValue)) {
    alert("Email, password, and tenant ID or name required.");
    return;
  }
  try {
    const payload = { email, password, role };
    if (tenantValue) {
      payload.tenant_name = tenantValue;
    }
    await apiFetch("/admin/api/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    userEmailInput.value = "";
    userPasswordInput.value = "";
    await loadUsers();
    await refreshDashboard();
  } catch (err) {
    alert(err.message);
  }
});

userRoleInput.addEventListener("change", () => {
  if (userRoleInput.value === "DEVELOPER") {
    userTenantInput.placeholder = "Tenant ID or name (optional)";
  } else {
    userTenantInput.placeholder = "Tenant ID or name";
  }
});

createTenantBtn.addEventListener("click", async () => {
  tenantCreateStatus.textContent = "";
  const name = tenantNameInput.value.trim();
  const groupId = tenantGroupInput.value.trim();
  if (!name) {
    tenantCreateStatus.textContent = "Tenant name required.";
    return;
  }
  try {
    await apiFetch("/admin/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name, group_id: groupId || null })
    });
    tenantNameInput.value = "";
    tenantGroupInput.value = "";
    await loadTenants();
    await refreshDashboard();
    tenantCreateStatus.textContent = "Tenant created.";
  } catch (err) {
    tenantCreateStatus.textContent = err.message || "Failed to create tenant.";
  }
});

const getAllowedRolesForCreator = () => {
  if (currentRole === "DEVELOPER") return ["USER", "ADMIN", "DEALERADMIN", "DEVELOPER"];
  if (currentRole === "DEALERADMIN") return ["USER", "ADMIN"];
  if (currentRole === "ADMIN") return ["USER"];
  return [];
};

const loadAuthMe = async () => {
  const data = await apiFetch("/auth/me");
  currentRole = data.role;
  if (currentRole === "USER") {
    window.location.href = "/login?redirect=/admin";
    return;
  }
  const allowedRoles = getAllowedRolesForCreator();
  Array.from(userRoleInput.options).forEach((opt) => {
    opt.hidden = !allowedRoles.includes(opt.value);
  });
  if (!allowedRoles.includes(userRoleInput.value)) {
    userRoleInput.value = allowedRoles[0] ?? "";
  }
  if (!allowedRoles.length) {
    createUserBtn.disabled = true;
  }
  if (currentRole !== "DEVELOPER") {
    if (createTenantRow) createTenantRow.style.display = "none";
    if (createGroupRow) createGroupRow.style.display = "none";
    if (tenantPicker) tenantPicker.style.display = "none";
    userTenantInput.placeholder = "Tenant ID or name";
  } else if (tenantPicker) {
    tenantPicker.style.display = "flex";
    const saved = localStorage.getItem(tenantStorageKey) ?? "";
    if (tenantSelector) tenantSelector.value = saved;
    userTenantInput.placeholder = "Tenant ID or name (optional)";
  }
};

const bootstrap = async () => {
  try {
    await loadAuthMe();
    await loadTenants();
    await loadIngestSummary();
    await loadChatSummary();
    try {
      await loadGroups();
    } catch (err) {
      disableSection("groups");
    }
    try {
      await loadUsers();
    } catch (err) {
      disableSection("users");
    }
    await loadAudit();
    setInterval(() => {
      refreshDashboard();
    }, 30000);
  } catch (err) {
    tenantSummary.textContent = err.message;
  }
};

bootstrap();
