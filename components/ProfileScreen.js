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

const COLORS = ['#58cc02', '#1cb0f6', '#ff9600', '#ce82ff', '#ff4b4b', '#2ec4b6', '#e84393'];

export default function ProfileScreen({ session }) {
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
        ? (colorByClassroom[n.classroom_id] || '#58cc02')
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Identity */}
      <View style={styles.headerRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{email[0].toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.email} numberOfLines={1}>{email}</Text>
          <Text style={styles.sub}>{nodes.length} concepts in your brain</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={rebuild} disabled={building} activeOpacity={0.8}>
          {building ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="sparkles" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      {/* Gamification: daily-goal ring + stat tiles */}
      <View style={styles.statsRow}>
        <GoalRing size={84} progress={goalPct} color={goalPct >= 1 ? '#ff9600' : '#58cc02'}>
          <Text style={styles.ringValue}>{dailyXp}</Text>
          <Text style={styles.ringGoal}>/ {dailyGoal} XP</Text>
        </GoalRing>
        <View style={styles.statTiles}>
          <View style={styles.statTile}>
            <Text style={styles.statNum}>🔥 {streak}</Text>
            <Text style={styles.statLabel}>day streak</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={styles.statNum}>⭐ {totalXp}</Text>
            <Text style={styles.statLabel}>total XP</Text>
          </View>
        </View>
      </View>

      {/* Scope chips */}
      <View style={{ height: 44 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="Whole brain" active={scope === 'all'} onPress={() => setScope('all')} dot="#3c3c3c" />
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
          <View style={styles.center}><ActivityIndicator color="#58cc02" /></View>
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
            <TouchableOpacity style={styles.buildBtn} onPress={rebuild} disabled={building} activeOpacity={0.8}>
              {building ? <ActivityIndicator color="#fff" /> : <Text style={styles.buildBtnText}>BUILD MY BRAIN</Text>}
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
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress} activeOpacity={0.8}>
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
<circle cx="50" cy="50" r="42" fill="none" stroke="#ededed" stroke-width="11"/>
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
<style>html,body{margin:0;padding:0;overflow:hidden;background:#fff;}canvas{display:block;touch-action:none;}</style>
</head><body><canvas id="c"></canvas><script>
const NODES = ${nodesJson};
const EDGES = ${edgesJson};
const canvas=document.getElementById('c');const ctx=canvas.getContext('2d');
let W=0,H=0;const DPR=window.devicePixelRatio||1;
function resize(){W=window.innerWidth;H=window.innerHeight;canvas.width=W*DPR;canvas.height=H*DPR;canvas.style.width=W+'px';canvas.style.height=H+'px';ctx.setTransform(DPR,0,0,DPR,0,0);}
resize();window.addEventListener('resize',resize);
const nodes=NODES.map((n,i)=>({...n,x:W/2+Math.cos(i*1.7)*(50+i*4),y:H/2+Math.sin(i*1.7)*(50+i*4),vx:0,vy:0,r:14,deg:0}));
const byId={};nodes.forEach(n=>byId[n.id]=n);
const edges=EDGES.filter(e=>byId[e.source]&&byId[e.target]);
edges.forEach(e=>{byId[e.source].deg++;byId[e.target].deg++;});
nodes.forEach(n=>{n.r=14+Math.min(n.deg,8)*2;});
let scale=1,ox=0,oy=0,alpha=1;
let dragNode=null,panning=false,lastX=0,lastY=0,moved=0,pinch=null;
function step(){
  for(let i=0;i<nodes.length;i++){for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j];let dx=a.x-b.x,dy=a.y-b.y;let d2=dx*dx+dy*dy+0.01;let d=Math.sqrt(d2);
    const f=3500/d2;const fx=dx/d*f,fy=dy/d*f;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;}}
  edges.forEach(e=>{const a=byId[e.source],b=byId[e.target];let dx=b.x-a.x,dy=b.y-a.y;let d=Math.sqrt(dx*dx+dy*dy)+0.01;
    const f=(d-95)*0.02;const fx=dx/d*f,fy=dy/d*f;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;});
  nodes.forEach(n=>{n.vx+=(W/2-n.x)*0.0009;n.vy+=(H/2-n.y)*0.0009;if(n===dragNode)return;n.vx*=0.86;n.vy*=0.86;n.x+=n.vx*alpha;n.y+=n.vy*alpha;});
  if(alpha>0.04)alpha*=0.992;
}
function draw(){
  ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
  edges.forEach(e=>{const a=byId[e.source],b=byId[e.target];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    if(e.kind==='shared'){ctx.strokeStyle='#ce82ff';ctx.lineWidth=2;ctx.setLineDash([5,4]);}else{ctx.strokeStyle='#dcdcdc';ctx.lineWidth=1.5;ctx.setLineDash([]);}ctx.stroke();});
  ctx.setLineDash([]);
  nodes.forEach(n=>{ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,6.2832);ctx.fillStyle=n.color||'#58cc02';ctx.fill();ctx.lineWidth=2.5;ctx.strokeStyle='#fff';ctx.stroke();
    ctx.fillStyle='#3c3c3c';ctx.font='600 11px -apple-system,Roboto,Helvetica,sans-serif';ctx.textAlign='center';ctx.fillText(n.label,n.x,n.y+n.r+13);});
  ctx.restore();
}
function loop(){step();draw();requestAnimationFrame(loop);}loop();
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
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#58cc02', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  email: { fontSize: 16, color: '#3c3c3c', fontWeight: '700' },
  sub: { fontSize: 13, color: '#999', marginTop: 2 },
  refreshBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ce82ff',
    borderBottomWidth: 3, borderBottomColor: '#a568cc', justifyContent: 'center', alignItems: 'center' },

  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 },
  ringValue: { fontSize: 20, fontWeight: 'bold', color: '#3c3c3c', lineHeight: 22 },
  ringGoal: { fontSize: 11, color: '#999', fontWeight: '600' },
  statTiles: { flex: 1, flexDirection: 'row', gap: 10 },
  statTile: { flex: 1, backgroundColor: '#f7f7f7', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: 'bold', color: '#3c3c3c' },
  statLabel: { fontSize: 12, color: '#999', marginTop: 2 },

  chipRow: { gap: 8, paddingRight: 8, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20, borderWidth: 2, borderColor: '#e5e5e5', backgroundColor: '#fff' },
  chipActive: { borderColor: '#58cc02', backgroundColor: '#eafce0' },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  chipText: { fontSize: 14, fontWeight: '600', color: '#777', maxWidth: 140 },
  chipTextActive: { color: '#58a700' },

  legendRow: { gap: 14, paddingHorizontal: 4, alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 12, color: '#888', maxWidth: 140 },

  graphWrap: { flex: 1, marginTop: 10, borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: '#f0f0f0', backgroundColor: '#fff' },
  web: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  hint: { position: 'absolute', bottom: 8, alignSelf: 'center', fontSize: 11, color: '#bbb' },

  emptyEmoji: { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 19, fontWeight: 'bold', color: '#3c3c3c' },
  emptySub: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 8, lineHeight: 20, marginBottom: 20 },
  buildBtn: { backgroundColor: '#58cc02', borderBottomWidth: 4, borderBottomColor: '#58a700',
    paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14 },
  buildBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15, letterSpacing: 0.5 },

  signOut: { textAlign: 'center', color: '#bbb', fontSize: 14, fontWeight: '600', paddingVertical: 16 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#e5e5e5', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 22, fontWeight: 'bold', color: '#3c3c3c', marginBottom: 10 },
  sheetFrom: { fontSize: 13, color: '#1cb0f6', fontWeight: '600', marginBottom: 10 },
  sheetSummary: { fontSize: 15, color: '#4b4b4b', lineHeight: 22 },
  sheetClose: { marginTop: 24, backgroundColor: '#f0f0f0', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  sheetCloseText: { color: '#777', fontWeight: 'bold', letterSpacing: 0.5 },
});
