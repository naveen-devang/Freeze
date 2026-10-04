import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, Check, ChevronDown, ChevronRight, Monitor, QrCode, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react-native';
import { connectionId, PcConnection, usePcConnection } from '../../connection';
import { colors } from '../../theme';
import { ScreenSettingsSection } from '../../screen-power';

type PairingCode = PcConnection & { type: 'freeze-pair'; version: 1 };

function decodePairingCode(data: string): PcConnection | null {
  try {
    const code = JSON.parse(data) as Partial<PairingCode>;
    if (
      code.type !== 'freeze-pair' ||
      code.version !== 1 ||
      typeof code.host !== 'string' ||
      !code.host ||
      code.host.length > 253 ||
      /[\s/?#]/.test(code.host) ||
      !Number.isInteger(code.port) ||
      (code.port ?? 0) < 1 ||
      (code.port ?? 0) > 65535 ||
      typeof code.token !== 'string' ||
      !/^[a-f\d]{64}$/i.test(code.token)
    ) return null;
    return { host: code.host, port: code.port!, token: code.token, deviceName: typeof code.deviceName === 'string' ? code.deviceName : code.host, transport: code.transport === 'usb' ? 'usb' : 'wifi' };
  } catch {
    return null;
  }
}

export default function ConnectScreen() {
  const { connection, pairedDevices, status, protocolError, connect, disconnect, removePairedDevice } = usePcConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [draft, setDraft] = useState<{ host: string; port: string; token: string; deviceName: string } | null>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const scanLock = useRef(false);
  const form = draft ?? { host: connection?.host ?? '', port: String(connection?.port ?? 39421), token: connection?.token ?? '', deviceName: connection?.deviceName ?? '' };
  const connected = status === 'connected';
  const connecting = status === 'connecting';

  const switchTransport = async (transport: 'wifi' | 'usb') => {
    if (!connection || connection.transport === transport) return;
    setError('');
    try {
      await connect({ ...connection, transport });
    } catch {
      setError('Could not save the connection mode. Try again.');
    }
  };

  const startScan = async () => {
    setError('');
    scanLock.current = false;
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Allow camera access to scan the QR code.');
        return;
      }
    }
    setScanning(true);
  };

  const handleScan = async ({ data }: { data: string }) => {
    if (scanLock.current) return;
    scanLock.current = true;
    const next = decodePairingCode(data);
    setScanning(false);
    if (!next) {
      setError('That QR code is not a valid Freeze pairing code.');
      return;
    }
    setError('');
    setDraft({ ...next, port: String(next.port), deviceName: next.deviceName ?? next.host });
    try {
      await connect(next);
    } catch {
      setError('Could not save the connection on this phone. Try again.');
    }
  };

  const submit = async () => {
    setError('');
    const cleanHost = form.host.trim().replace(/^wss?:\/\//i, '').replace(/\/ws\/?$/i, '');
    const parsedPort = Number(form.port);
    if (!cleanHost || cleanHost.includes('/') || !Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535 || !/^[a-f\d]{64}$/i.test(form.token.trim())) {
      setError('Enter the PC address, port, and pairing key shown in the PC app.');
      return;
    }
    try {
      await connect({ host: cleanHost, port: parsedPort, token: form.token.trim(), deviceName: form.deviceName.trim() || cleanHost });
    } catch {
      setError('Could not save the connection on this phone. Try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Connect</Text>
          <Text style={styles.description}>Pair this phone with the Freeze app running on your PC.</Text>

          <View style={[styles.statusCard, connected ? styles.statusGood : connecting ? styles.statusPending : styles.statusIdle]}>
            <Monitor size={17} color={connected ? colors.mint : colors.muted} />
            <View style={styles.statusCopy}>
              <Text style={styles.statusTitle}>{connected ? 'Connected to your PC' : connecting ? 'Connecting…' : status === 'error' ? 'Could not connect' : 'No PC connected'}</Text>
              <Text style={styles.statusSub}>{connected ? connection?.transport === 'usb' ? 'Connected by Android USB' : `${connection?.host}:${connection?.port}` : protocolError ?? (connecting && connection?.transport === 'usb' ? 'Reconnecting over USB…' : status === 'error' ? 'Check the connection and confirm the PC app is running.' : connection ? 'Tap Retry under Paired devices when the PC is available.' : 'Scan the code on the PC to connect.')}</Text>
            </View>
            {connected && <Check size={16} color={colors.mint} />}
          </View>

          {Platform.OS === 'android' && connection ? <View style={styles.transportRow}>
            <Text style={styles.transportTitle}>Connection mode</Text>
            <View style={styles.transportSwitch}>
              <Pressable style={[styles.transportButton, connection.transport !== 'usb' && styles.transportActive]} onPress={() => void switchTransport('wifi')} accessibilityRole="button" accessibilityState={{ selected: connection.transport !== 'usb' }}><Text style={[styles.transportText, connection.transport !== 'usb' && styles.transportTextActive]}>Wi-Fi</Text></Pressable>
              <Pressable style={[styles.transportButton, connection.transport === 'usb' && styles.transportActive]} onPress={() => void switchTransport('usb')} accessibilityRole="button" accessibilityState={{ selected: connection.transport === 'usb' }}><Text style={[styles.transportText, connection.transport === 'usb' && styles.transportTextActive]}>USB</Text></Pressable>
            </View>
            <Text style={styles.transportHint}>Pair once. Switch modes without scanning again.</Text>
          </View> : null}

          {scanning ? (
            <View style={styles.scannerCard}>
              <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={handleScan} />
              <Text style={styles.scanHint}>Point your camera at the QR code on your PC</Text>
              <Pressable style={styles.cancelScan} onPress={() => setScanning(false)} accessibilityRole="button"><Text style={styles.cancelScanText}>Cancel scan</Text></Pressable>
            </View>
          ) : (
            <Pressable style={({ pressed }) => [styles.scanButton, pressed && styles.pressed, connecting && styles.disabled]} onPress={() => void startScan()} disabled={connecting} accessibilityRole="button">
              <QrCode size={19} color={colors.text} strokeWidth={1.8} />
              <View style={styles.scanCopy}><Text style={styles.scanTitle}>{connecting ? 'Connecting…' : 'Scan QR code'}</Text><Text style={styles.scanSubtitle}>Connect without entering details</Text></View>
              <ChevronRight size={16} color={colors.faint} />
            </Pressable>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.manualToggle} onPress={() => setManualOpen(!manualOpen)} accessibilityRole="button" accessibilityState={{ expanded: manualOpen }}>
            <Text style={styles.manualTitle}>Manual setup</Text>
            {manualOpen ? <ChevronDown size={16} color={colors.faint} /> : <ChevronRight size={16} color={colors.faint} />}
          </Pressable>
          {manualOpen && <View style={styles.manualCard}>
            <Text style={styles.label}>Device name</Text>
            <TextInput value={form.deviceName} onChangeText={(deviceName) => setDraft({ ...form, deviceName })} placeholder="My PC" placeholderTextColor={colors.faint} autoCapitalize="words" style={styles.input} accessibilityLabel="Device name" />
            <Text style={styles.label}>PC address</Text>
            <TextInput value={form.host} onChangeText={(host) => setDraft({ ...form, host })} placeholder="192.168.1.24" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="next" style={styles.input} accessibilityLabel="PC address" />
            <View style={styles.portRow}>
              <View style={styles.portField}><Text style={styles.label}>Port</Text><TextInput value={form.port} onChangeText={(port) => setDraft({ ...form, port })} keyboardType="number-pad" style={styles.input} accessibilityLabel="Port" /></View>
              <Text style={styles.portHint}>Find the address and port in the PC app.</Text>
            </View>
            <Text style={styles.label}>Pairing key</Text>
            <TextInput value={form.token} onChangeText={(token) => setDraft({ ...form, token })} placeholder="Paste the pairing key" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.input} accessibilityLabel="Pairing key" />
            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, connecting && styles.disabled]} onPress={() => void submit()} disabled={connecting} accessibilityRole="button"><Text style={styles.primaryText}>{connecting ? 'Connecting…' : 'Connect manually'}</Text></Pressable>
          </View>}

          <View style={styles.pairedSection}>
            <View style={styles.pairedHeader}><Text style={styles.pairedTitle}>Paired devices</Text><Text style={styles.pairedCount}>{pairedDevices.length}</Text></View>
            {pairedDevices.length === 0 ? <Text style={styles.emptyPaired}>No paired PCs yet. Scan a QR code or enter details above.</Text> : pairedDevices.map((device) => {
              const active = Boolean(connection && connectionId(connection) === connectionId(device));
              const deviceStatus = active ? status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Not connected' : 'Not connected';
              const actionLabel = !active ? 'Connect' : status === 'connected' || status === 'connecting' ? 'Disconnect' : 'Retry';
              return <View key={connectionId(device)} style={styles.deviceRow}>
                <View style={styles.deviceCopy}>
                  <Text style={styles.deviceName} numberOfLines={1}>{device.deviceName || device.host}</Text>
                  <Text style={styles.deviceAddress} numberOfLines={1}>{device.host}:{device.port}</Text>
                </View>
                <View style={styles.deviceActions}>
                  <View style={styles.deviceStatus}><View style={[styles.statusDot, deviceStatus === 'Connected' && styles.statusDotConnected, deviceStatus === 'Connecting' && styles.statusDotConnecting]} /><Text style={[styles.deviceStatusText, deviceStatus === 'Connected' && styles.deviceStatusConnected]}>{deviceStatus}</Text></View>
                  <View style={styles.deviceButtons}>
                    <Pressable style={styles.deviceButton} onPress={() => void (actionLabel === 'Disconnect' ? disconnect() : connect(device))} accessibilityRole="button" accessibilityLabel={`${actionLabel} ${actionLabel === 'Disconnect' ? 'from' : 'to'} ${device.deviceName || device.host}`} disabled={active && status === 'connecting'}>
                      {actionLabel === 'Retry' && <RefreshCw size={12} color={colors.text} />}
                      <Text style={[styles.deviceButtonText, actionLabel === 'Disconnect' && styles.deviceDisconnectText]}>{actionLabel}</Text>
                    </Pressable>
                    <Pressable style={styles.removeButton} onPress={() => void removePairedDevice(connectionId(device))} accessibilityRole="button" accessibilityLabel={`Remove ${device.deviceName || device.host}`}><Trash2 size={14} color={colors.faint} /></Pressable>
                  </View>
                </View>
              </View>;
            })}
          </View>

          <ScreenSettingsSection />

          <View style={styles.localNote}><ShieldCheck size={15} color={colors.muted} /><Text style={styles.localNoteText}>{connection?.transport === 'usb' ? 'Direct Android USB connection through authorized USB debugging.' : 'Direct connection over your local Wi-Fi. Use a trusted network.'}</Text></View>
          {!permission?.granted && !scanning && <View style={styles.permissionNote}><Camera size={14} color={colors.faint} /><Text style={styles.permissionText}>Camera access is only used to scan the pairing code.</Text></View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: 18, paddingBottom: 28 },
  title: { color: colors.text, fontSize: 23, fontWeight: '600', letterSpacing: -0.3, marginTop: 17 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 17, marginTop: 5 },
  statusCard: { borderRadius: 7, borderWidth: 1, padding: 13, marginTop: 19, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusGood: { backgroundColor: '#111a14', borderColor: '#28392d' },
  statusPending: { backgroundColor: colors.panel, borderColor: colors.border },
  statusIdle: { backgroundColor: colors.panel, borderColor: colors.border },
  statusCopy: { flex: 1 },
  statusTitle: { color: colors.text, fontWeight: '500', fontSize: 14 },
  statusSub: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 13 },
  transportRow: { marginTop: 14, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.panel },
  transportTitle: { color: colors.text, fontSize: 13, fontWeight: '500' },
  transportSwitch: { flexDirection: 'row', marginTop: 9, padding: 3, gap: 3, borderRadius: 5, backgroundColor: colors.bg },
  transportButton: { flex: 1, height: 31, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  transportActive: { backgroundColor: colors.pressed },
  transportText: { color: colors.muted, fontSize: 13 },
  transportTextActive: { color: colors.text, fontWeight: '500' },
  transportHint: { color: colors.faint, fontSize: 12, marginTop: 8 },
  scanButton: { minHeight: 61, borderWidth: 1, borderColor: '#3f3f46', borderRadius: 7, backgroundColor: colors.panelRaised, marginTop: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  scanCopy: { flex: 1 },
  scanTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  scanSubtitle: { color: colors.muted, fontSize: 12, marginTop: 4 },
  scannerCard: { marginTop: 13, padding: 9, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, alignItems: 'center' },
  camera: { width: '100%', height: 245, borderRadius: 4, overflow: 'hidden' },
  scanHint: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 10 },
  cancelScan: { padding: 10 },
  cancelScanText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  error: { color: colors.red, fontSize: 13, marginTop: 10, lineHeight: 15 },
  manualToggle: { minHeight: 44, marginTop: 15, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  manualTitle: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  manualCard: { padding: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.panel },
  label: { color: colors.muted, fontSize: 13, fontWeight: '500', marginBottom: 6 },
  input: { height: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 5, backgroundColor: colors.bg, paddingHorizontal: 10, color: colors.text, fontSize: 14, marginBottom: 13 },
  portRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  portField: { width: 95 },
  portHint: { flex: 1, paddingBottom: 25, color: colors.faint, fontSize: 12, lineHeight: 14 },
  primaryButton: { height: 41, borderRadius: 5, backgroundColor: '#e4e4e7', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  primaryText: { color: '#18181b', fontSize: 14, fontWeight: '600' },
  pairedSection: { marginTop: 15, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.panel },
  pairedHeader: { minHeight: 43, marginBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pairedTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  pairedCount: { color: colors.muted, backgroundColor: colors.bg, overflow: 'hidden', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, fontSize: 12 },
  emptyPaired: { color: colors.faint, fontSize: 13, lineHeight: 15, paddingVertical: 10 },
  deviceRow: { minHeight: 63, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 },
  deviceCopy: { flex: 1, minWidth: 0 },
  deviceName: { color: colors.text, fontSize: 14, fontWeight: '500' },
  deviceAddress: { color: colors.faint, fontSize: 12, marginTop: 4 },
  deviceActions: { alignItems: 'flex-end', gap: 6 },
  deviceStatus: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.faint },
  statusDotConnected: { backgroundColor: colors.mint },
  statusDotConnecting: { backgroundColor: '#eab308' },
  deviceStatusText: { color: colors.faint, fontSize: 12 },
  deviceStatusConnected: { color: colors.mint },
  deviceButtons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deviceButton: { minWidth: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 8, borderWidth: 1, borderRadius: 4, borderColor: colors.border, backgroundColor: colors.bg },
  deviceButtonText: { color: colors.text, fontSize: 12, fontWeight: '500' },
  deviceDisconnectText: { color: colors.red },
  removeButton: { padding: 6 },
  localNote: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 13, marginTop: 15, flexDirection: 'row', alignItems: 'center', gap: 8 },
  localNoteText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 14 },
  permissionNote: { marginTop: 10, flexDirection: 'row', gap: 7, alignItems: 'center' },
  permissionText: { color: colors.faint, fontSize: 12 },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.5 },
});
