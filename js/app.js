(() => {
 const cfg=window.PORTAL_CONFIG, $=id=>document.getElementById(id);
 const configured=cfg.supabaseUrl.startsWith("https://") && !cfg.supabaseUrl.includes("YOUR_") && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes("YOUR_");
 let sb=null, user=null, profile=null, authMode="signin", activeLesson=null, activeFolderId=null;
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const toast=m=>{const t=$("toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)};
 const views=["welcomeView","studentView","lessonView","teacherView","recoveryView"];
 function show(id){views.forEach(v=>$(v).classList.toggle("hidden",v!==id));window.scrollTo({top:0,behavior:"smooth"});}
 function err(m){$("authError").textContent=m||""}
 function localDate(s){if(!s)return "No deadline set";const d=new Date(s);return isNaN(d)?"Invalid deadline":d.toLocaleString()}
 function countdown(deadline){if(!deadline)return "No deadline set";const ms=new Date(deadline)-Date.now();if(ms<=0)return "Deadline passed";const d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);return `${d}d ${h}h ${m}m ${s}s remaining`}
 function validUrl(s){try{const u=new URL(s);return u.protocol==="https:"||u.protocol==="http:"}catch{return false}}
 
async function forgotPassword(e){
 e.preventDefault();if(!sb){err("Password reset is not configured yet.");return}
 const email=$("email").value.trim();if(!email){err("Enter your email address first, then click Forgot password.");$("email").focus();return}
 try{const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname+"?reset=1"});if(error)throw error;err("If an account exists for this email, a password reset link will be sent. Check your inbox and spam folder.");}
 catch(e){err(e.message||"Unable to send the password reset email.")}
}
async function saveNewPassword(e){
 e.preventDefault();const password=$("newPassword").value,confirm=$("confirmNewPassword").value,out=$("recoveryError");out.textContent="";
 if(password.length<8){out.textContent="Use at least 8 characters for your new password.";return}
 if(password!==confirm){out.textContent="The passwords do not match.";return}
 try{const {error}=await sb.auth.updateUser({password});if(error)throw error;await sb.auth.signOut();$("recoveryForm").reset();history.replaceState({},document.title,window.location.pathname);show("welcomeView");setAuthMode("signin");err("Password updated. Sign in with your new password.");toast("Password updated successfully.");}
 catch(e){out.textContent=e.message||"Unable to update the password."}
}
async function authSubmit(e){e.preventDefault();err("");if(!configured){err("Setup needed: add your Supabase URL and anon key in js/config.js, then run supabase/setup.sql.");return}
 const email=$("email").value.trim(),password=$("password").value;
 try{
  if(authMode==="signup"){
   const batchCode=$("batchCode").value.trim().toUpperCase(),fullName=$("studentName").value.trim();
   if(!batchCode||!fullName){err("Enter your batch code and full name.");return}
   const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:fullName,batch_code:batchCode,role:"student"}}});
   if(error)throw error;
   if(data.session){await loadSession();toast("Student account created.");}else err("Account created. Check your email to confirm it, then sign in.");
  } else {
   const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;await loadSession();
  }
 }catch(e){err(e.message||"Unable to sign in.")}
 }
 async function loadSession(){
  const {data:{session}}=await sb.auth.getSession();user=session?.user||null;
  $("signOut").classList.toggle("hidden",!user);
  if(!user){show("welcomeView");return}
  const {data:p,error}=await sb.from("profiles").select("*").eq("id",user.id).maybeSingle();
  if(error)throw error;profile=p;
  if(!profile){show("welcomeView");err("Profile not found. Confirm your email and try again.");return}
  if(profile.role==="teacher"){show("teacherView");await renderTeacher()}else{show("studentView");await renderStudent()}
 }
 async function renderStudent(){
 $("studentHeading").textContent=`Welcome, ${profile.full_name||user.email}`;
 $("studentSub").textContent=`Batch: ${profile.batch_code||"Not assigned"} · Open a class to read instructions and submit your link.`;
 const {data:batch,error:be}=await sb.from("batches").select("*").eq("code",profile.batch_code).eq("active",true).maybeSingle();if(be)throw be;
 if(!batch){$("studentLessons").innerHTML='<p class="empty">Your batch is inactive or not assigned. Please contact your teacher.</p>';return}
 const [{data:assignments,error:ae},{data:subs,error:se}]=await Promise.all([
  sb.from("batch_lessons").select("lesson_id,deadline,lessons(*)").eq("batch_id",batch.id),
  sb.from("submissions").select("lesson_id,submitted_at,url").eq("student_id",user.id)
 ]);
 if(ae)throw ae;if(se)throw se;
 const done=new Map((subs||[]).map(s=>[s.lesson_id,s]));
 const assigned=(assignments||[]).filter(a=>a.lessons).map(a=>({...a.lessons,deadline:a.deadline}));
 $("studentLessons").innerHTML=assigned.sort((a,b)=>a.number-b.number).map(l=>{
  const s=done.get(l.id),unlocked=l.number<=batch.unlocked_through;
  return `<button class="lesson-card" data-open="${l.id}" ${!unlocked?"disabled":""}><span class="lesson-num">${String(l.number).padStart(2,"0")}</span><span class="lesson-info"><b>${esc(l.title)}</b><small>${esc(l.summary||"Homework and resources")}</small><small>${s?"✓ Submitted":l.deadline&&new Date(l.deadline)<new Date()?"Deadline passed":l.deadline?"Deadline: "+esc(localDate(l.deadline)):"No deadline set"}</small></span><span class="lesson-arrow">${s?"✓":unlocked?"↗":"🔒"}</span></button>`
 }).join("")||'<p class="empty">No classes have been assigned to your batch yet.</p>';
 $("studentLessons").querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openLesson(b.dataset.open)));
}
async function openLesson(id){
  const {data:l,error}=await sb.from("lessons").select("*").eq("id",id).single();if(error){toast(error.message);return}
  const {data:batch}=await sb.from("batches").select("id").eq("code",profile.batch_code).maybeSingle();
  const {data:assignment,error:assignmentError}=await sb.from("batch_lessons").select("deadline").eq("batch_id",batch.id).eq("lesson_id",id).maybeSingle();
  if(assignmentError||!assignment){toast(assignmentError?.message||"This class is not assigned to your batch.");return}
  l.deadline=assignment.deadline;
  const {data:s}=await sb.from("submissions").select("*").eq("lesson_id",id).eq("student_id",user.id).maybeSingle();activeLesson=l;
  $("lessonContent").innerHTML=`<span class="eyebrow">${esc(profile.batch_code)} · CLASS ${String(l.number).padStart(2,"0")}</span><h1>${esc(l.title)}</h1><p class="lesson-summary">${esc(l.summary||"")}</p><div class="lesson-body">${esc(l.body||"").split(/\n\s*\n/).map(p=>`<p>${p.replace(/\n/g,"<br>")}</p>`).join("")}</div>${(l.links||[]).length?`<div class="resource-box"><h3>Resources</h3>${l.links.map((u,i)=>`<p><a href="${esc(u)}" target="_blank" rel="noopener">Open resource ${i+1} ↗</a><small>${esc(u)}</small></p>`).join("")}</div>`:""}<div class="submit-box"><h3>Homework submission</h3><p><b>Deadline:</b> ${esc(localDate(l.deadline))}</p><p id="countdown" class="countdown">${esc(countdown(l.deadline))}</p>${s?`<div class="success">Submitted on ${esc(new Date(s.submitted_at).toLocaleString())}. This submission is locked.<p><a href="${esc(s.url)}" target="_blank" rel="noopener">View submitted link ↗</a></p></div>`:l.deadline&&new Date(l.deadline)<=new Date()?'<p class="error">The deadline has passed. Submissions are closed.</p>':`<form id="submissionForm"><label for="submissionUrl">Homework URL</label><input id="submissionUrl" type="url" required placeholder="https://..."><button class="primary" type="submit">Submit homework</button><p class="micro-note">You can submit only once for this class. Check the link before submitting.</p><p id="submitError" class="error"></p></form>`}</div>`;
  show("lessonView");
  if(l.deadline&&!s){const tick=()=>{const el=$("countdown");if(el)el.textContent=countdown(l.deadline)};tick();const timer=setInterval(()=>{if(!$("countdown")){clearInterval(timer);return}tick();if(new Date(l.deadline)<=new Date()){const f=$("submissionForm");if(f)f.remove();}},1000)}
  if(!s&&(!l.deadline||new Date(l.deadline)>new Date()))$("submissionForm").addEventListener("submit",submitHomework);
 }
 async function submitHomework(e){
  e.preventDefault();const url=$("submissionUrl").value.trim(),out=$("submitError");if(!validUrl(url)){out.textContent="Enter a valid http:// or https:// link.";return}
  const b=e.currentTarget.querySelector("button");b.disabled=true;
  const {error}=await sb.from("submissions").insert({lesson_id:activeLesson.id,student_id:user.id,url});
  if(error){out.textContent=error.code==="23505"?"A submission already exists for this class.":error.message;b.disabled=false;return}
  toast("Homework submitted and locked.");await openLesson(activeLesson.id);
 }
 async function renderTeacher(){await Promise.all([renderBatches(),renderLessons(),renderSubmissions()])}
 async function renderBatches(){
 const list=$("batchList");
 const {data:folders,error:fe}=await sb.from("teacher_folders").select("*").eq("teacher_id",user.id).order("name");
 if(fe){toast(fe.message);return}
 const {data:batches,error:be}=await sb.from("batches").select("*").order("code");
 if(be){toast(be.message);return}
 const mine=folders||[], all=batches||[];
 // Keep legacy/unassigned batches visible in a special folder until the teacher moves them.
 const legacy=all.filter(b=>!b.folder_id || !mine.some(f=>f.id===b.folder_id));
 const folderCard=f=>`<section class="teacher-folder folder-card"><button type="button" class="folder-open" data-open-folder="${f.id}"><span class="folder-icon">📁</span><span class="folder-card-info"><b>${esc(f.name)}</b><small>${all.filter(b=>b.folder_id===f.id).length} batches</small></span><span class="folder-arrow">Open →</span></button><div class="folder-actions"><button class="ghost small" data-rename-folder="${f.id}" data-name="${esc(f.name)}">Rename</button><button class="ghost small danger-ghost" data-delete-folder="${f.id}">Delete folder</button></div></section>`;
 if(activeFolderId && !mine.some(f=>f.id===activeFolderId)) activeFolderId=null;
 if(!activeFolderId){
  list.innerHTML=`<div class="folder-toolbar"><div><h3>Your folders</h3><p class="micro-note">Create a folder first, then open it to create and manage batches.</p></div></div><div class="folder-grid">${mine.map(folderCard).join("")}</div>${legacy.length?`<section class="teacher-folder legacy-folder"><div class="teacher-folder-title"><span>📂</span><div><b>Existing / unfiled batches</b><small>${legacy.length} batches — move each into one of your folders</small></div></div>${legacy.map(b=>`<div class="data-row"><div class="row-main"><b>${esc(b.code)}</b><small>${b.active?"Active":"Inactive"} · max 50 students</small></div><select data-move-batch="${b.id}" aria-label="Move ${esc(b.code)} to folder"><option value="">Choose folder…</option>${mine.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></div>`).join("")}</section>`:""}<p class="empty ${mine.length||legacy.length?"hidden":""}">No folders yet. Create your first folder above.</p>`;
  list.querySelectorAll("[data-open-folder]").forEach(el=>el.addEventListener("click",()=>{activeFolderId=el.dataset.openFolder;renderBatches()}));
  list.querySelectorAll("[data-rename-folder]").forEach(el=>el.addEventListener("click",async()=>{const name=prompt("Enter a new folder name:",el.dataset.name);if(name===null)return;if(!name.trim()){toast("Folder name cannot be empty.");return}const {error}=await sb.from("teacher_folders").update({name:name.trim()}).eq("id",el.dataset.renameFolder).eq("teacher_id",user.id);if(error)toast(error.message);else{toast("Folder renamed.");renderBatches()}}));
  list.querySelectorAll("[data-delete-folder]").forEach(el=>el.addEventListener("click",async()=>{const f=mine.find(x=>x.id===el.dataset.deleteFolder);const count=all.filter(b=>b.folder_id===f.id).length;if(!confirm(`Delete folder “${f.name}”? ${count?count+" batch(es) will be moved to Existing / unfiled batches; students and submissions will not be deleted.":"This folder is empty."}`))return;const {error}=await sb.from("teacher_folders").delete().eq("id",f.id).eq("teacher_id",user.id);if(error)toast(error.message);else{toast("Folder deleted.");renderBatches()}}));
  list.querySelectorAll("[data-move-batch]").forEach(el=>el.addEventListener("change",async()=>{if(!el.value)return;const {error}=await sb.from("batches").update({folder_id:el.value,teacher_id:user.id}).eq("id",el.dataset.moveBatch);if(error)toast(error.message);else{toast("Batch moved into folder.");renderBatches()}}));
  return;
 }
 const folder=mine.find(f=>f.id===activeFolderId),items=all.filter(b=>b.folder_id===activeFolderId);
 list.innerHTML=`<div class="folder-toolbar"><button type="button" class="ghost" id="backFolders">← All folders</button><div><h3>📁 ${esc(folder.name)}</h3><p class="micro-note">Create batches inside this folder. Each batch can have up to 50 students.</p></div><button type="button" class="ghost small" id="renameCurrentFolder">Rename folder</button></div><form id="batchFormInside" class="inline-form"><div><label>New batch code</label><input id="newBatchCodeInside" required placeholder="e.g. PVE 2607"></div><button class="primary">+ Create batch</button></form><div class="data-list">${items.map(b=>`<div class="data-row batch-row"><div class="row-main"><b>${esc(b.code)}</b><small>${b.active?"Active":"Inactive"} · ${b.unlocked_through}/${cfg.totalClasses} classes unlocked · max 50 students</small></div><label class="unlock-control">Unlock through <select data-unlock="${b.id}">${Array.from({length:cfg.totalClasses+1},(_,n)=>`<option value="${n}" ${n===b.unlocked_through?"selected":""}>${n}</option>`).join("")}</select></label><button class="ghost small" data-assign="${b.id}">Assign classes / deadlines</button><button class="ghost small" data-active="${b.id}" data-value="${!b.active}">${b.active?"Deactivate":"Activate"}</button><button class="ghost small" data-remove-batch="${b.id}">Move out</button></div>`).join("")||'<p class="empty">This folder is empty. Create your first batch above.</p>'}</div>`;
 $("backFolders").addEventListener("click",()=>{activeFolderId=null;renderBatches()});
 $("renameCurrentFolder").addEventListener("click",async()=>{const name=prompt("Enter a new folder name:",folder.name);if(name===null)return;if(!name.trim()){toast("Folder name cannot be empty.");return}const {error}=await sb.from("teacher_folders").update({name:name.trim()}).eq("id",folder.id).eq("teacher_id",user.id);if(error)toast(error.message);else renderBatches()});
 $("batchFormInside").addEventListener("submit",async e=>{e.preventDefault();const code=$("newBatchCodeInside").value.trim().toUpperCase();if(!code)return;const {error}=await sb.from("batches").insert({code,teacher_id:user.id,folder_id:folder.id});if(error)toast(error.message);else{toast("Batch created in this folder.");renderBatches()}});
 list.querySelectorAll("[data-unlock]").forEach(el=>el.addEventListener("change",async()=>{const {error}=await sb.from("batches").update({unlocked_through:Number(el.value)}).eq("id",el.dataset.unlock);toast(error?error.message:"Batch unlock saved.")}));
 list.querySelectorAll("[data-active]").forEach(el=>el.addEventListener("click",async()=>{const {error}=await sb.from("batches").update({active:el.dataset.value==="true"}).eq("id",el.dataset.active);if(error)toast(error.message);else renderBatches()}));
 list.querySelectorAll("[data-assign]").forEach(el=>el.addEventListener("click",()=>openBatchAssignments(el.dataset.assign)));
 list.querySelectorAll("[data-remove-batch]").forEach(el=>el.addEventListener("click",async()=>{if(!confirm("Move this batch out of the folder? Students and submissions will be kept."))return;const {error}=await sb.from("batches").update({folder_id:null}).eq("id",el.dataset.removeBatch);if(error)toast(error.message);else{toast("Batch moved out of folder.");renderBatches()}}));
 }
 async function addFolder(e){e.preventDefault();const name=$("newFolderName").value.trim();if(!name){toast("Enter a folder name.");return}const {data,error}=await sb.from("teacher_folders").insert({name,teacher_id:user.id}).select("id").single();if(error){toast(error.message);return}$("newFolderName").value="";activeFolderId=null;toast("Folder created.");await renderBatches()}
async function openBatchAssignments(batchId){
 const {data:batch,error:be}=await sb.from("batches").select("*").eq("id",batchId).single();if(be){toast(be.message);return}
 const [{data:lessons,error:le},{data:assignments,error:ae}]=await Promise.all([sb.from("lessons").select("*").order("number"),sb.from("batch_lessons").select("*").eq("batch_id",batchId)]);
 if(le||ae){toast((le||ae).message);return}
 const existing=new Map((assignments||[]).map(a=>[a.lesson_id,a]));
 const dtLocal=v=>v?new Date(new Date(v).getTime()-new Date(v).getTimezoneOffset()*60000).toISOString().slice(0,16):"";
 $("assignmentEditor")?.remove();const section=document.createElement("section");section.id="assignmentEditor";section.className="assignment-editor";
 section.innerHTML=`<div class="panel-title"><div><h2>Classes for ${esc(batch.code)}</h2><p class="micro-note">Tick each class to assign it. Deadlines are independent for this batch.</p></div><button type="button" id="closeAssignment" class="ghost">Close</button></div><form id="assignmentForm"><div class="assignment-list">${(lessons||[]).map(l=>{const a=existing.get(l.id);return `<div class="assignment-item"><label class="assignment-check"><input type="checkbox" name="assigned" value="${l.id}" ${a?"checked":""}><span><b>Class ${String(l.number).padStart(2,"0")} — ${esc(l.title)}</b><small>${esc(l.summary||"")}</small></span></label><label class="assignment-deadline">Deadline <input type="datetime-local" data-deadline="${l.id}" value="${dtLocal(a?.deadline)}"></label></div>`}).join("")||'<p class="empty">Create classes in the Homework library first.</p>'}</div><button class="primary" type="submit">Save assignments and deadlines</button><p id="assignmentError" class="error"></p></form>`;
 $("batchesPanel").appendChild(section);section.scrollIntoView({behavior:"smooth",block:"start"});$("closeAssignment").addEventListener("click",()=>section.remove());
 $("assignmentForm").addEventListener("submit",async e=>{e.preventDefault();const out=$("assignmentError");out.textContent="";const selected=new Set([...section.querySelectorAll('input[name="assigned"]:checked')].map(x=>x.value));const rows=[];
 for(const lesson of lessons||[]){if(!selected.has(lesson.id))continue;const raw=section.querySelector(`[data-deadline="${lesson.id}"]`).value;rows.push({batch_id:batchId,lesson_id:lesson.id,deadline:raw?new Date(raw).toISOString():null})}
 const removed=(assignments||[]).map(a=>a.lesson_id).filter(id=>!selected.has(id));
 try{if(rows.length){const {error}=await sb.from("batch_lessons").upsert(rows,{onConflict:"batch_id,lesson_id"});if(error)throw error}if(removed.length){const {error}=await sb.from("batch_lessons").delete().eq("batch_id",batchId).in("lesson_id",removed);if(error)throw error}toast("Batch class assignments saved.");section.remove();await renderBatches()}catch(err){out.textContent=err.message||"Could not save assignments."}
 });
}
function clearLessonForm(){$("lessonForm").reset();$("lessonId").value="";$("lessonForm").classList.add("hidden")}
 async function renderLessons(){const {data,error}=await sb.from("lessons").select("*").order("number");if(error){toast(error.message);return}
 $("homeworkList").innerHTML=(data||[]).map(l=>`<div class="data-row"><div class="row-main"><b>Class ${String(l.number).padStart(2,"0")} — ${esc(l.title)}</b><small>${esc(l.summary||"No summary")} · Shared lesson content</small></div><button class="ghost small" data-edit="${l.id}">Edit</button></div>`).join("")||'<p class="empty">No classes yet. Create the first one.</p>';
 $("homeworkList").querySelectorAll("[data-edit]").forEach(btn=>btn.addEventListener("click",()=>editLesson(btn.dataset.edit)));
 }
 async function editLesson(id){const {data:l,error}=await sb.from("lessons").select("*").eq("id",id).single();if(error){toast(error.message);return}
 $("lessonId").value=l.id;$("lessonNumber").value=l.number;$("lessonTitle").value=l.title;$("lessonSummary").value=l.summary||"";$("lessonBody").value=l.body||"";$("lessonLinks").value=(l.links||[]).join("\n");$("lessonForm").classList.remove("hidden");$("lessonForm").scrollIntoView({behavior:"smooth"})}
 async function saveLesson(e){e.preventDefault();const id=$("lessonId").value;const n=Number($("lessonNumber").value);
 const row={number:n,title:$("lessonTitle").value.trim(),summary:$("lessonSummary").value.trim(),body:$("lessonBody").value.trim(),links:$("lessonLinks").value.split("\n").map(s=>s.trim()).filter(Boolean)};
 if(row.links.some(u=>!validUrl(u))){toast("Each resource must be a valid http(s) URL.");return}
 const q=id?sb.from("lessons").update(row).eq("id",id):sb.from("lessons").insert(row);const {error}=await q;if(error){toast(error.message);return}clearLessonForm();await renderLessons();toast("Class saved to shared database.")}
 
async function renderSubmissions() {
  const list = $("submissionList");

  list.innerHTML = '<p class="empty">Loading submissions...</p>';

  const [batchResult, lessonResult, submissionResult] = await Promise.all([
    sb.from("batches").select("*").order("code"),
    sb.from("lessons").select("*").order("number"),
    sb.from("submissions")
      .select("id,url,submitted_at,student_id,lesson_id,profiles(full_name,email,batch_code),lessons(id,number,title)")
      .order("submitted_at", { ascending: false })
  ]);

  const problem = batchResult.error || lessonResult.error || submissionResult.error;

  if (problem) {
    list.innerHTML = `<p class="error">${esc(problem.message)}</p>`;
    return;
  }

  const batches = batchResult.data || [];
  const lessons = lessonResult.data || [];
  const submissions = submissionResult.data || [];

  let selectedBatch = null;
  let selectedLesson = null;

  function renderBatchFolders() {
    selectedBatch = null;
    selectedLesson = null;

    list.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:20px">
        <div>
          <h3 style="margin:0">Submission folders</h3>
          <p style="margin:6px 0 0;color:#777">Choose a batch to browse its classes.</p>
        </div>
        <span>${batches.length} batches</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
        ${batches.map(batch => {
          const count = submissions.filter(s =>
            s.profiles?.batch_code === batch.code
          ).length;

          const classCount = lessons.filter(l =>
            submissions.some(s =>
              s.profiles?.batch_code === batch.code &&
              s.lesson_id === l.id
            )
          ).length;

          return `
            <button type="button"
              data-submission-batch="${esc(batch.code)}"
              style="text-align:left;padding:20px;border:1px solid #e5e5e5;border-radius:12px;background:#fff;cursor:pointer;color:#222">
              <div style="font-size:28px;margin-bottom:12px">📁</div>
              <strong style="font-size:16px">${esc(batch.code)}</strong>
              <div style="margin-top:8px;color:#777;font-size:13px">
                ${count} submissions · ${classCount} classes with submissions
              </div>
              <div style="margin-top:14px;color:#cf2035;font-weight:600">
                Open batch →
              </div>
            </button>
          `;
        }).join("")}
      </div>

      ${batches.length ? "" : '<p class="empty">No batches found. Create a batch in the Batches tab.</p>'}
    `;

    list.querySelectorAll("[data-submission-batch]").forEach(button => {
      button.addEventListener("click", () => {
        const batch = batches.find(b =>
          b.code === button.dataset.submissionBatch
        );
        if (batch) renderClassFolders(batch);
      });
    });
  }

  function renderClassFolders(batch) {
    selectedBatch = batch;
    selectedLesson = null;

    list.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px">
        <button type="button" id="submissionBack"
          class="ghost small">← All batches</button>
        <div>
          <h3 style="margin:0">📁 ${esc(batch.code)}</h3>
          <p style="margin:6px 0 0;color:#777">Select a class to view its submissions.</p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
        ${lessons.map(lesson => {
          const count = submissions.filter(s =>
            s.profiles?.batch_code === batch.code &&
            s.lesson_id === lesson.id
          ).length;

          return `
            <button type="button"
              data-submission-class="${esc(lesson.id)}"
              style="text-align:left;padding:18px;border:1px solid #e5e5e5;border-radius:12px;background:#fff;cursor:pointer;color:#222">
              <div style="font-size:25px;margin-bottom:10px">📂</div>
              <strong>Class ${String(lesson.number).padStart(2, "0")}</strong>
              <div style="margin-top:6px">${esc(lesson.title)}</div>
              <div style="margin-top:10px;color:#777;font-size:13px">
                ${count} submission${count === 1 ? "" : "s"}
              </div>
              <div style="margin-top:12px;color:#cf2035;font-weight:600">
                View submissions →
              </div>
            </button>
          `;
        }).join("")}
      </div>

      ${lessons.length ? "" : '<p class="empty">No classes have been created yet.</p>'}
    `;

    $("submissionBack").addEventListener("click", renderBatchFolders);

    list.querySelectorAll("[data-submission-class]").forEach(button => {
      button.addEventListener("click", () => {
        const lesson = lessons.find(l =>
          l.id === button.dataset.submissionClass
        );
        if (lesson) renderClassSubmissions(batch, lesson);
      });
    });
  }

  function renderClassSubmissions(batch, lesson) {
    selectedBatch = batch;
    selectedLesson = lesson;

    const matching = submissions.filter(s =>
      s.profiles?.batch_code === batch.code &&
      s.lesson_id === lesson.id
    );

    list.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:22px">
        <button type="button" id="submissionBack"
          class="ghost small">← Back to classes</button>
        <div>
          <h3 style="margin:0">${esc(batch.code)}</h3>
          <p style="margin:6px 0 0;color:#777">
            Class ${String(lesson.number).padStart(2, "0")} — ${esc(lesson.title)}
          </p>
        </div>
        <span style="margin-left:auto;font-weight:600">
          ${matching.length} submission${matching.length === 1 ? "" : "s"}
        </span>
      </div>

      ${matching.map(s => `
        <div class="data-row">
          <div class="row-main">
            <b>${esc(s.profiles?.full_name || s.profiles?.email || "Student")}</b>
            <small>${esc(s.profiles?.email || "")}</small>
            <small>Submitted: ${esc(new Date(s.submitted_at).toLocaleString())}</small>
            <a href="${esc(s.url)}" target="_blank" rel="noopener">
              Open homework submission ↗
            </a>
          </div>
        </div>
      `).join("") || '<p class="empty">No submissions for this class yet.</p>'}
    `;

    $("submissionBack").addEventListener("click", () =>
      renderClassFolders(batch)
    );
  }

  renderBatchFolders();
}

 async function addBatch(e){e.preventDefault();const code=$("newBatchCode").value.trim().toUpperCase();const {error}=await sb.from("batches").insert({code,teacher_id:user.id});if(error)toast(error.message);else{$("newBatchCode").value="";toast("Batch created.");renderBatches()}}
 function setAuthMode(mode){authMode=mode;document.querySelectorAll("[data-auth]").forEach(b=>b.classList.toggle("active",b.dataset.auth===mode));$("signupFields").classList.toggle("hidden",mode!=="signup");$("authSubmit").textContent=mode==="signup"?"Create student account →":"Sign in →";err("")}
 document.querySelectorAll("[data-auth]").forEach(b=>b.addEventListener("click",()=>setAuthMode(b.dataset.auth)));
 $("authForm").addEventListener("submit",authSubmit);
 $("forgotPassword").addEventListener("click", forgotPassword);
 $("recoveryForm").addEventListener("submit",saveNewPassword);
 $("signOut").addEventListener("click",async()=>{await sb.auth.signOut();user=null;profile=null;show("welcomeView");$("signOut").classList.add("hidden")});
 $("backToLessons").addEventListener("click",()=>{show("studentView");renderStudent()});
 $("createFolderForm").addEventListener("submit",addFolder);$("newLesson").addEventListener("click",()=>{$("lessonForm").reset();$("lessonId").value="";$("lessonForm").classList.remove("hidden");});
 $("cancelLesson").addEventListener("click",clearLessonForm);$("lessonForm").addEventListener("submit",saveLesson);$("refreshSubmissions").addEventListener("click",renderSubmissions);
 document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));["batches","lessons","submissions"].forEach(k=>$(k+"Panel").classList.toggle("hidden",b.dataset.tab!==k));}));
 $("brandName").textContent=cfg.brandName;$("siteLogo").src=cfg.logoPath;$("year").textContent=new Date().getFullYear();
 if(!configured){$("authError").textContent="To activate shared features, configure Supabase in js/config.js and run supabase/setup.sql."}
 else {sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);sb.auth.onAuthStateChange((event,session)=>{if(event==="PASSWORD_RECOVERY"){show("recoveryView");return}if(new URLSearchParams(window.location.search).has("reset")&&session){show("recoveryView");return}setTimeout(()=>loadSession().catch(e=>{show("welcomeView");err(e.message)}),0)});sb.auth.getSession().then(({data})=>{if(data.session){if(new URLSearchParams(window.location.search).has("reset"))show("recoveryView");else loadSession().catch(e=>err(e.message))}})}
})();