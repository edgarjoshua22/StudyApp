import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import { palette, space, radius, type, shadow, solid } from '../lib/theme';

const COLORS = [
  palette.green, palette.blue, palette.orange, palette.purple,
  palette.red, palette.teal, palette.pink,
];

export default function ProfileScreen({ session, navigation }) {
  const email = session.user.email;
  const [classrooms, setClassrooms] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [scope, setScope] = useState('all');     // 'all' or a classroom id
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [graphKey, setGraphKey] = useState(0);
  const [profile, setProfile] = useState(null);

  useFocusEffect(useCallback(() => { fetchBrain(); }, []));

  async function fetchBrain() {
    setLoading(true);
    const [cls, nds, eds, dcs, prof] = await Promise.all([
      supabase.from('classrooms').select('id,name').order('created_at', { ascending: true }),
      supabase.from('brain_nodes').select('id,label,summary,classroom_id,document_id'),
      supabase.from('brain_edges').select('source_node_id,target_node_id,kind'),
      supabase.from('documents').select('id,file_name,classroom_id'),
      supabase.from('profiles')
        .select('xp,daily_xp,daily_xp_date,daily_goal,current_streak,longest_streak,last_active_date')
        .eq('id', session.user.id).maybeSingle(),
    ]);
    setClassrooms(cls.data || []);
    setNodes(nds.data || []);
    setEdges(eds.data || []);
    setDocuments(dcs.data || []);
    setProfile(prof.data || null);
    setGraphKey((k) => k + 1);
    setLoading(false);
  }

  const colorByClassroom = useMemo(() => {
    const map = {};
    classrooms.forEach((c, i) => { map[c.id] = COLORS[i % COLORS.length]; });
    return map;
  }, [classrooms]);

  const docNameById = useMemo(() => {
    const m = {};
    documents.forEach((d) => { m[d.id] = d.file_name; });
    return m;
  }, [documents]);

  // In a single-classroom view, each handout gets its own color
  const docColorById = useMemo(() => {
    const m = {};
    if (scope !== 'all') {
      documents.filter((d) => d.classroom_id === scope)
        .forEach((d, i) => { m[d.id] = COLORS[i % COLORS.length]; });
    }
    return m;
  }, [documents, scope]);

  // Nodes + edges for the current scope
  const { graphNodes, graphEdges } = useMemo(() => {
    const vis = scope === 'all' ? nodes : nodes.filter((n) => n.classroom_id === scope);
    const idSet = new Set(vis.map((n) => n.id));
    const gNodes = vis.map((n) => ({
      id: n.id,
      label: n.label,
      summary: n.summary || '',
      doc: docNameById[n.document_id] || '',
      color: scope === 'all'
        ? (colorByClassroom[n.classroom_id] || palette.green)
        : (docColorById[n.document_id] || '#9aa0a6'),
    }));
    const gEdges = edges
      .filter((e) => idSet.has(e.source_node_id) && idSet.has(e.target_node_id))
      .map((e) => ({ source: e.source_node_id, target: e.target_node_id, kind: e.kind }));
    return { graphNodes: gNodes, graphEdges: gEdges };
  }, [nodes, edges, scope, colorByClassroom, docColorById, docNameById]);

  const html = useMemo(() => buildHtml(graphNodes, graphEdges), [graphNodes, graphEdges]);

  async function rebuild() {
    const targets = scope === 'all' ? classrooms.map((c) => c.id) : [scope];
    if (targets.length === 0) {
      Alert.alert('No classrooms', 'Add a classroom and upload a handout first.');
      return;
    }
    setBuilding(true);
    try {
      for (const id of targets) {
        const res = await fetch(`${API_BASE}/build-brain?classroom_id=${id}`, { method: 'POST' });
        const data = await res.json();
        if (data.error && targets.length === 1) throw new Error(data.error);
      }
      await fetchBrain();
    } catch (e) {
      Alert.alert('Could not build brain', e.message || 'Make sure the backend (Docker) is running.');
    } finally {
      setBuilding(false);
    }
  }

  function onMessage(event) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'node') setSelectedNode({ label: msg.label, summary: msg.summary, doc: msg.doc });
    } catch (_) { /* ignore */ }
  }

  const hasNodes = graphNodes.length > 0;

  // ---- Gamification stats (3c) ----
  const todayStr = new Date().toLocaleDateString('en-CA');             // YYYY-MM-DD (local)
  const yesterdayStr = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-CA');
  })();
  const dailyGoal = profile?.daily_goal ?? 50;
  const dailyXp = profile?.daily_xp_date === todayStr ? (profile?.daily_xp ?? 0) : 0;
  const goalPct = dailyGoal > 0 ? Math.min(dailyXp / dailyGoal, 1) : 0;
  const streakAlive = profile?.last_active_date === todayStr || profile?.last_active_date === yesterdayStr;
  const streak = streakAlive ? (profile?.current_streak ?? 0) : 0;
  const totalXp = profile?.xp ?? 0;
  const longest = profile?.longest_streak ?? 0;
  const goalReached = goalPct >= 1;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {navigation ? (
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-down" size={26} color={palette.inkSoft} />
        </TouchableOpacity>
      ) : null}
      {/* Identity */}
      <View style={styles.headerRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{email[0].toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.email} numberOfLines={1}>{email.split('@')[0]}</Text>
          <Text style={styles.sub}>🧠 {nodes.length} concepts mapped</Text>
        </View>
        <TouchableOpacity
          style={[styles.refreshBtn, solid(palette.purple, palette.purpleDark, radius.pill)]}
          onPress={rebuild} disabled={building} activeOpacity={0.85}
        >
          {building ? <ActivityIndicator color={palette.white} size="small" /> : <Ionicons name="sparkles" size={18} color={palette.white} />}
        </TouchableOpacity>
      </View>

      {/* Gamification: daily-goal ring + stat tiles */}
      <View style={styles.statsRow}>
        <View style={[styles.ringCard, goalReached && { backgroundColor: palette.orangeSoft }]}>
          <GoalRing size={78} progress={goalPct} color={goalReached ? palette.orange : palette.green}>
            <Text style={styles.ringValue}>{dailyXp}</Text>
            <Text style={styles.ringGoal}>/ {dailyGoal}</Text>
          </GoalRing>
          <Text style={styles.ringCaption}>{goalReached ? '🏆 Goal done!' : "Today's goal"}</Text>
        </View>
        <View style={styles.statTiles}>
          <View style={[styles.statTile, { backgroundColor: palette.orangeSoft }]}>
            <Text style={styles.statNum}>🔥 {streak}</Text>
            <Text style={[styles.statLabel, { color: palette.orangeDark }]}>day streak</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: '#36300f' }]}>
            <Text style={styles.statNum}>⭐ {totalXp}</Text>
            <Text style={[styles.statLabel, { color: palette.goldDark }]}>total XP</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: palette.purpleSoft }]}>
            <Text style={styles.statNum}>🏅 {longest}</Text>
            <Text style={[styles.statLabel, { color: palette.purpleDark }]}>best streak</Text>
          </View>
        </View>
      </View>

      {/* Brain section label */}
      <Text style={styles.brainLabel}>SECOND BRAIN</Text>

      {/* Scope chips */}
      <View style={{ height: 44 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="Whole brain" active={scope === 'all'} onPress={() => setScope('all')} dot={palette.ink} />
          {classrooms.map((c) => (
            <Chip key={c.id} label={c.name} active={scope === c.id}
              onPress={() => setScope(c.id)} dot={colorByClassroom[c.id]} />
          ))}
        </ScrollView>
      </View>

      {/* Handout legend: in a classroom view, each handout is its own color */}
      {scope !== 'all' && documents.some((d) => d.classroom_id === scope) && (
        <View style={{ height: 34 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legendRow}>
            {documents.filter((d) => d.classroom_id === scope).map((d, i) => (
              <View key={d.id} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS[i % COLORS.length] }]} />
                <Text style={styles.legendText} numberOfLines={1}>{d.file_name}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
      <View style={styles.graphWrap}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={palette.green} /></View>
        ) : hasNodes ? (
          <WebView
            key={`${scope}-${graphKey}`}
            originWhitelist={['*']}
            source={{ html }}
            onMessage={onMessage}
            style={styles.web}
            scrollEnabled={false}
          />
        ) : (
          <View style={styles.center}>
            <Text style={styles.emptyEmoji}>🧠</Text>
            <Text style={styles.emptyTitle}>
              {scope === 'all' ? 'Your brain is empty' : 'Nothing here yet'}
            </Text>
            <Text style={styles.emptySub}>
              Upload handouts in a classroom, then tap the ✨ button to map your concepts.
            </Text>
            <TouchableOpacity
              style={[styles.buildBtn, solid(palette.green, palette.greenDark, radius.lg)]}
              onPress={rebuild} disabled={building} activeOpacity={0.85}
            >
              {building ? <ActivityIndicator color={palette.white} /> : <Text style={styles.buildBtnText}>BUILD MY BRAIN</Text>}
            </TouchableOpacity>
          </View>
        )}
        {hasNodes && (
          <Text style={styles.hint}>Drag to move · pinch to zoom · tap a concept</Text>
        )}
      </View>

      <TouchableOpacity onPress={() => supabase.auth.signOut()} activeOpacity={0.7}>
        <Text style={styles.signOut}>Sign out</Text>
      </TouchableOpacity>

      {/* Node detail */}
      <Modal visible={!!selectedNode} transparent animationType="slide" onRequestClose={() => setSelectedNode(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelectedNode(null)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{selectedNode?.label}</Text>
            {selectedNode?.doc ? <Text style={styles.sheetFrom}>From: {selectedNode.doc}</Text> : null}
            <Text style={styles.sheetSummary}>
              {selectedNode?.summary || 'No summary for this concept yet.'}
            </Text>
            <TouchableOpacity style={styles.sheetClose} onPress={() => setSelectedNode(null)}>
              <Text style={styles.sheetCloseText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress, dot }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.chipDot, { backgroundColor: dot }]} />
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

// Dependency-free circular progress ring rendered as an inline SVG in a tiny WebView.
function GoalRing({ size = 84, progress = 0, color = '#58cc02', children }) {
  const p = Math.max(0, Math.min(1, progress));
  const C = 263.9; // circumference for r=42
  const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}svg{display:block;}</style>
</head><body>
<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<circle cx="50" cy="50" r="42" fill="none" stroke="#37464f" stroke-width="11"/>
<circle cx="50" cy="50" r="42" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"
  stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - p)).toFixed(2)}" transform="rotate(-90 50 50)"/>
</svg></body></html>`;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ width: size, height: size, backgroundColor: 'transparent' }}
        containerStyle={{ backgroundColor: 'transparent' }}
        scrollEnabled={false}
        pointerEvents="none"
        androidLayerType="hardware"
      />
      <View style={{ position: 'absolute', alignItems: 'center' }}>{children}</View>
    </View>
  );
}

// Builds the self-contained force-graph page. NODES/EDGES are injected as JSON.
function buildHtml(graphNodes, graphEdges) {
  const nodesJson = JSON.stringify(graphNodes).replace(/</g, '\\u003c');
  const edgesJson = JSON.stringify(graphEdges).replace(/</g, '\\u003c');
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;padding:0;overflow:hidden;background:#131f24;}canvas{display:block;touch-action:none;}</style>
</head><body><canvas id="c"></canvas><script>
const NODES = ${nodesJson};
const EDGES = ${edgesJson};
const canvas=document.getElementById('c');const ctx=canvas.getContext('2d');
let W=0,H=0;const DPR=window.devicePixelRatio||1;
function resize(){W=window.innerWidth;H=window.innerHeight;canvas.width=W*DPR;canvas.height=H*DPR;canvas.style.width=W+'px';canvas.style.height=H+'px';ctx.setTransform(DPR,0,0,DPR,0,0);}
resize();window.addEventListener('resize',resize);
// Even, untangled starting spread (golden-angle "sunflower" layout)
const GA=Math.PI*(3-Math.sqrt(5));
const SP=Math.min(W,H)*0.05+24;
const nodes=NODES.map((n,i)=>{const rr=SP*Math.sqrt(i+0.5);const a=i*GA;return {...n,x:W/2+Math.cos(a)*rr,y:H/2+Math.sin(a)*rr,vx:0,vy:0,r:14,deg:0};});
const byId={};nodes.forEach(n=>byId[n.id]=n);
const edges=EDGES.filter(e=>byId[e.source]&&byId[e.target]);
edges.forEach(e=>{byId[e.source].deg++;byId[e.target].deg++;});
nodes.forEach(n=>{n.r=14+Math.min(n.deg,8)*2;});
let scale=1,ox=0,oy=0,alpha=1;
let dragNode=null,panning=false,lastX=0,lastY=0,moved=0,pinch=null;
function step(){
  // repulsion + hard collision so nodes never sit on top of each other
  for(let i=0;i<nodes.length;i++){for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j];let dx=a.x-b.x,dy=a.y-b.y;let d2=dx*dx+dy*dy+0.01;let d=Math.sqrt(d2);
    let f=4200/d2;const minD=a.r+b.r+12;if(d<minD)f+=(minD-d)*0.9;
    const fx=dx/d*f,fy=dy/d*f;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;}}
  // springs pull linked concepts together
  edges.forEach(e=>{const a=byId[e.source],b=byId[e.target];let dx=b.x-a.x,dy=b.y-a.y;let d=Math.sqrt(dx*dx+dy*dy)+0.01;
    const f=(d-90)*0.025;const fx=dx/d*f,fy=dy/d*f;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;});
  // gentle pull to center + damping
  nodes.forEach(n=>{n.vx+=(W/2-n.x)*0.0012;n.vy+=(H/2-n.y)*0.0012;if(n===dragNode)return;n.vx*=0.85;n.vy*=0.85;n.x+=n.vx*alpha;n.y+=n.vy*alpha;});
}
// Pre-warm the layout BEFORE the first frame, so the brain opens already separated.
alpha=1;for(let k=0;k<450;k++){step();if(alpha>0.05)alpha*=0.99;}
alpha=0.05;
function draw(){
  ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
  edges.forEach(e=>{const a=byId[e.source],b=byId[e.target];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    if(e.kind==='shared'){ctx.strokeStyle='#ce82ff';ctx.lineWidth=2;ctx.setLineDash([5,4]);}else{ctx.strokeStyle='#3a4a53';ctx.lineWidth=1.5;ctx.setLineDash([]);}ctx.stroke();});
  ctx.setLineDash([]);
  nodes.forEach(n=>{ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,6.2832);ctx.fillStyle=n.color||'#58cc02';ctx.fill();ctx.lineWidth=2.5;ctx.strokeStyle='#131f24';ctx.stroke();
    ctx.fillStyle='#f4f8fb';ctx.font='600 11px -apple-system,Roboto,Helvetica,sans-serif';ctx.textAlign='center';ctx.fillText(n.label,n.x,n.y+n.r+13);});
  ctx.restore();
}
function loop(){step();if(alpha>0.02)alpha*=0.995;draw();requestAnimationFrame(loop);}loop();
function toWorld(px,py){return {x:(px-ox)/scale,y:(py-oy)/scale};}
function nodeAt(px,py){const p=toWorld(px,py);for(let i=nodes.length-1;i>=0;i--){const n=nodes[i];const dx=p.x-n.x,dy=p.y-n.y;if(dx*dx+dy*dy<=(n.r+6)*(n.r+6))return n;}return null;}
function pinchInfo(ev){const a=ev.touches[0],b=ev.touches[1];const dx=a.clientX-b.clientX,dy=a.clientY-b.clientY;return{dist:Math.sqrt(dx*dx+dy*dy)||1,mx:(a.clientX+b.clientX)/2,my:(a.clientY+b.clientY)/2};}
function post(n){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({type:'node',id:n.id,label:n.label,summary:n.summary||'',doc:n.doc||''}));}}
canvas.addEventListener('touchstart',ev=>{
  if(ev.touches.length===1){const t=ev.touches[0];lastX=t.clientX;lastY=t.clientY;moved=0;const n=nodeAt(t.clientX,t.clientY);if(n){dragNode=n;}else{panning=true;}}
  else if(ev.touches.length===2){dragNode=null;panning=false;pinch=pinchInfo(ev);}
},{passive:false});
canvas.addEventListener('touchmove',ev=>{ev.preventDefault();
  if(ev.touches.length===2&&pinch){const p=pinchInfo(ev);const ns=Math.max(0.3,Math.min(3,scale*(p.dist/pinch.dist)));
    ox=p.mx-(p.mx-ox)*(ns/scale);oy=p.my-(p.my-oy)*(ns/scale);scale=ns;pinch=p;return;}
  const t=ev.touches[0];if(!t)return;const dx=t.clientX-lastX,dy=t.clientY-lastY;moved+=Math.abs(dx)+Math.abs(dy);lastX=t.clientX;lastY=t.clientY;
  if(dragNode){const p=toWorld(t.clientX,t.clientY);dragNode.x=p.x;dragNode.y=p.y;dragNode.vx=0;dragNode.vy=0;alpha=Math.max(alpha,0.35);}
  else if(panning){ox+=dx;oy+=dy;}
},{passive:false});
canvas.addEventListener('touchend',ev=>{if(dragNode&&moved<6)post(dragNode);if(ev.touches.length===0){dragNode=null;panning=false;pinch=null;}},{passive:false});
</script></body></html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft, paddingHorizontal: space.lg },
  closeBtn: { alignSelf: 'flex-start', paddingVertical: 4, marginTop: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, marginBottom: space.lg },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: palette.green, borderBottomWidth: 3, borderBottomColor: palette.greenDark, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 24, fontWeight: '800', color: palette.white },
  email: { fontSize: 20, color: palette.ink, fontWeight: '800', textTransform: 'capitalize' },
  sub: { fontSize: 13, color: palette.inkSoft, marginTop: 2, fontWeight: '600' },
  refreshBtn: { width: 46, height: 46, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 3 },

  statsRow: { flexDirection: 'row', alignItems: 'stretch', gap: space.md, marginBottom: space.lg },
  ringCard: { backgroundColor: palette.bg, borderRadius: radius.lg, paddingVertical: space.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  ringValue: { fontSize: 19, fontWeight: '800', color: palette.ink, lineHeight: 21 },
  ringGoal: { fontSize: 11, color: palette.inkSoft, fontWeight: '700' },
  ringCaption: { fontSize: 11, color: palette.inkSoft, fontWeight: '700', marginTop: 6 },
  statTiles: { flex: 1, flexDirection: 'row', gap: space.sm },
  statTile: { flex: 1, borderRadius: radius.lg, paddingVertical: space.md, alignItems: 'center', justifyContent: 'center' },
  statNum: { fontSize: 17, fontWeight: '800', color: palette.ink },
  statLabel: { fontSize: 11, marginTop: 3, fontWeight: '800' },

  brainLabel: { ...type.tiny, color: palette.inkSoft, letterSpacing: 1.2, marginBottom: space.sm, marginLeft: 2 },

  chipRow: { gap: space.sm, paddingRight: space.sm, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: radius.pill, borderWidth: 2, borderColor: palette.line, backgroundColor: palette.bg },
  chipActive: { borderColor: palette.green, backgroundColor: palette.greenSoft },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  chipText: { fontSize: 14, fontWeight: '700', color: palette.inkSoft, maxWidth: 140 },
  chipTextActive: { color: palette.greenDark },

  legendRow: { gap: 14, paddingHorizontal: 4, alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 12, color: palette.inkSoft, maxWidth: 140 },

  graphWrap: { flex: 1, marginTop: 10, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: palette.bg, ...shadow.card },
  web: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  hint: { position: 'absolute', bottom: 8, alignSelf: 'center', fontSize: 11, color: palette.hint },

  emptyEmoji: { fontSize: 56, marginBottom: space.md },
  emptyTitle: { fontSize: 19, fontWeight: '800', color: palette.ink },
  emptySub: { fontSize: 14, color: palette.inkSoft, textAlign: 'center', marginTop: space.sm, lineHeight: 20, marginBottom: space.xl, fontWeight: '500' },
  buildBtn: { paddingVertical: 14, paddingHorizontal: 28 },
  buildBtnText: { color: palette.white, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },

  signOut: { textAlign: 'center', color: palette.hint, fontSize: 14, fontWeight: '700', paddingVertical: space.lg },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, paddingBottom: 36 },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: palette.line, alignSelf: 'center', marginBottom: space.lg },
  sheetTitle: { fontSize: 22, fontWeight: '800', color: palette.ink, marginBottom: 10 },
  sheetFrom: { fontSize: 13, color: palette.blueDark, fontWeight: '700', marginBottom: 10 },
  sheetSummary: { fontSize: 15, color: palette.ink, lineHeight: 22, fontWeight: '500' },
  sheetClose: { marginTop: space.xl, backgroundColor: palette.lineSoft, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  sheetCloseText: { color: palette.inkSoft, fontWeight: '800', letterSpacing: 0.5 },
});
