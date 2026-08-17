import { Feather, Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

const DEFAULT_URL =
  'https://video.sibnet.ru/v/b85c60dd8c85fd25641a21fbcbb3d20c/6223248.m3u8';
const HISTORY_KEY = '@hls-video-player/history';
const MAX_HISTORY = 5;

type PlaybackState = 'idle' | 'loading' | 'ready' | 'error';
type DownloadAction = 'save' | 'browser' | 'share';

function isValidStreamUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function shortenUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname.length > 22 ? `${parsed.pathname.slice(0, 22)}…` : parsed.pathname}`;
  } catch {
    return value;
  }
}

function getStreamHeaders(streamUrl: string): Record<string, string> {
  const parsed = new URL(streamUrl);
  const headers: Record<string, string> = {
    Accept: '*/*',
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  };

  if (parsed.hostname === 'video.sibnet.ru' || parsed.hostname.endsWith('.sibnet.ru')) {
    headers.Referer = 'https://video.sibnet.ru/';
    headers.Origin = 'https://video.sibnet.ru';
    headers['Accept-Language'] = 'fr-FR,fr;q=0.9,en;q=0.8';
  }

  if (parsed.hostname === 'uqload.vc' || parsed.hostname.endsWith('.uqload.vc')) {
    headers.Referer = 'https://uqload.to/';
    headers.Origin = 'https://uqload.to';
    headers['Accept-Language'] = 'fr-FR,fr;q=0.9,en;q=0.8';
  }

  return headers;
}

function getSignedUrlExpiry(streamUrl: string): number | null {
  try {
    const expiry = Number(new URL(streamUrl).searchParams.get('s'));
    return Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : null;
  } catch {
    return null;
  }
}

function formatExpiry(expiry: number) {
  return new Intl.DateTimeFormat('fr-BE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(expiry));
}

function getDownloadFilename(streamUrl: string) {
  try {
    const pathname = new URL(streamUrl).pathname;
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    if (lastSegment?.includes('.')) return lastSegment.split('?')[0];
  } catch {
    // Use the fallback below for malformed URLs; validation happens before download.
  }
  return 'flux-hls.m3u8';
}

export default function PlayerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string>(DEFAULT_URL);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [state, setState] = useState<PlaybackState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showDownloadOptions, setShowDownloadOptions] = useState(false);
  const [downloadState, setDownloadState] = useState<'idle' | 'working'>('idle');

  const player = useVideoPlayer(null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.audioMixingMode = 'doNotMix';
    videoPlayer.keepScreenOnWhilePlaying = true;
  });

  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(HISTORY_KEY)
      .then((stored) => {
        if (!stored || !isMounted) return;
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) setHistory(parsed.filter((item): item is string => typeof item === 'string'));
      })
      .catch(() => undefined);

    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (!isMounted) return;
      if (status === 'loading') setState('loading');
      if (status === 'readyToPlay') {
        setState('ready');
        setErrorMessage(null);
      }
      if (status === 'error') {
        setState('error');
        setErrorMessage(error?.message ?? 'Le serveur a refusé la lecture du flux.');
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [player]);

  const sourceLabel = useMemo(() => (activeUrl ? shortenUrl(activeUrl) : 'Aucun flux actif'), [activeUrl]);

  const persistHistory = async (nextHistory: string[]) => {
    setHistory(nextHistory);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
  };

  const openStream = async (candidate = url) => {
    const nextUrl = candidate.trim();
    if (!isValidStreamUrl(nextUrl)) {
      setState('error');
      setErrorMessage('Collez une adresse vidéo complète commençant par http:// ou https://.');
      return;
    }

    const signedUrlExpiry = getSignedUrlExpiry(nextUrl);
    if (signedUrlExpiry && signedUrlExpiry <= Date.now()) {
      setUrl(nextUrl);
      setActiveUrl(nextUrl);
      setState('error');
      setErrorMessage(`Ce lien signé a expiré le ${formatExpiry(signedUrlExpiry)}. Demandez un nouveau lien au site source.`);
      setShowDetails(false);
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUrl(nextUrl);
    setActiveUrl(nextUrl);
    setState('loading');
    setErrorMessage(null);
    setShowDetails(false);

    const nextHistory = [nextUrl, ...history.filter((item) => item !== nextUrl)].slice(0, MAX_HISTORY);
    await persistHistory(nextHistory);

    try {
      await player.replaceAsync({
        uri: nextUrl,
        contentType: 'hls',
        headers: getStreamHeaders(nextUrl),
        metadata: {
          title: 'HLS Video Player',
          artist: 'Flux HLS',
        },
      });
      player.play();
    } catch (error) {
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Impossible de charger ce flux.');
    }
  };

  const clearHistory = async () => {
    await Haptics.selectionAsync();
    await persistHistory([]);
  };

  const downloadSource = async (action: DownloadAction) => {
    const sourceUrl = (activeUrl ?? url).trim();
    if (!isValidStreamUrl(sourceUrl)) {
      setState('error');
      setErrorMessage('Collez une adresse vidéo valide avant de télécharger.');
      setShowDownloadOptions(false);
      return;
    }

    setShowDownloadOptions(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (action === 'browser') {
      await Linking.openURL(sourceUrl);
      return;
    }

    if (action === 'share') {
      await Share.share({
        message: sourceUrl,
        url: sourceUrl,
        title: 'Lien du flux vidéo',
      });
      return;
    }

    setDownloadState('working');
    try {
      const filename = getDownloadFilename(sourceUrl);
      const file = await File.downloadFileAsync(
        sourceUrl,
        new File(Paths.cache, filename),
        { headers: getStreamHeaders(sourceUrl), idempotent: true },
      );
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Fichier téléchargé', `Le fichier ${filename} est disponible dans le stockage de l’app.`);
        return;
      }
      await Sharing.shareAsync(file.uri, {
        UTI: 'public.playlist',
        mimeType: 'application/vnd.apple.mpegurl',
        dialogTitle: 'Enregistrer la playlist HLS',
      });
    } catch (error) {
      Alert.alert(
        'Téléchargement impossible',
        error instanceof Error ? error.message : 'Le serveur n’a pas autorisé le téléchargement de ce flux.',
      );
    } finally {
      setDownloadState('idle');
    }
  };

  const stateCopy = {
    idle: { label: 'Prêt à lire', color: colors.mutedForeground },
    loading: { label: 'Connexion au flux…', color: colors.warning },
    ready: { label: 'Lecture en cours', color: colors.success },
    error: { label: 'Accès refusé ou flux indisponible', color: colors.destructive },
  }[state];
  const signedUrlExpiry = activeUrl ? getSignedUrlExpiry(activeUrl) : null;
  const errorTitle = signedUrlExpiry && signedUrlExpiry <= Date.now()
    ? 'Le lien a expiré'
    : errorMessage?.includes('403')
      ? 'Le serveur a répondu 403'
      : 'Lecture refusée';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[colors.overlay, colors.background, colors.background]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 30,
        }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Ionicons name="play" size={20} color={colors.primaryForeground} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.accent }]}>LECTEUR HLS</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Ouvrir un flux.</Text>
          </View>
          <View style={[styles.livePill, { backgroundColor: colors.secondary }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.accent }]} />
            <Text style={[styles.liveText, { color: colors.secondaryForeground }]}>iOS ready</Text>
          </View>
        </View>

        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Collez une adresse .m3u8. L’app utilise le lecteur vidéo natif de l’iPhone.
        </Text>

        <View style={[styles.playerShell, { borderColor: colors.border, backgroundColor: colors.card }]}>
          {activeUrl ? (
            <VideoView
              player={player}
              style={styles.video}
              nativeControls
              contentFit="contain"
              allowsFullscreen
              allowsPictureInPicture
            />
          ) : (
            <View style={styles.emptyPlayer}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
                <Ionicons name="play-outline" size={34} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Votre vidéo apparaîtra ici</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Le lecteur gère les flux HLS en direct et les vidéos `.m3u8`.
              </Text>
            </View>
          )}
          {activeUrl && state === 'loading' ? (
            <View style={[styles.loadingBadge, { backgroundColor: colors.overlay }]}>
              <Text style={[styles.loadingBadgeText, { color: colors.warning }]}>CHARGEMENT</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: stateCopy.color }]} />
          <Text style={[styles.statusText, { color: colors.mutedForeground }]}>{stateCopy.label}</Text>
          {activeUrl ? (
            <Text numberOfLines={1} style={[styles.activeLabel, { color: colors.foreground }]}>
              {sourceLabel}
            </Text>
          ) : null}
        </View>

        <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.fieldHeader}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Adresse du flux</Text>
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>HLS / M3U8</Text>
          </View>
          <View style={[styles.inputWrap, { backgroundColor: colors.input, borderColor: colors.border }]}>
            <Ionicons name="link-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              testID="stream-url-input"
              value={url}
              onChangeText={setUrl}
              placeholder="https://…/video.m3u8"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => void openStream()}
              style={[styles.input, { color: colors.foreground }]}
            />
            {url.length > 0 ? (
              <Pressable
                accessibilityLabel="Effacer l’adresse"
                hitSlop={12}
                onPress={() => setUrl('')}
                style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
              >
                <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.actionRow}>
            <Pressable
              testID="open-stream-button"
              onPress={() => void openStream()}
              style={({ pressed }) => [
                styles.openButton,
                styles.playButton,
                { backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 },
              ]}
            >
              <Ionicons name="play" size={18} color={colors.primaryForeground} />
              <Text style={[styles.openButtonText, { color: colors.primaryForeground }]}>Lire le flux</Text>
              <Feather name="arrow-up-right" size={17} color={colors.primaryForeground} />
            </Pressable>
            <Pressable
              testID="download-button"
              accessibilityLabel="Télécharger le flux"
              onPress={() => setShowDownloadOptions(true)}
              style={({ pressed }) => [
                styles.openButton,
                styles.downloadButton,
                { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <Ionicons name="download-outline" size={19} color={colors.secondaryForeground} />
              <Text style={[styles.downloadButtonText, { color: colors.secondaryForeground }]}>Télécharger</Text>
            </Pressable>
          </View>
        </View>

        <Modal
          visible={showDownloadOptions}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDownloadOptions(false)}
        >
          <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
            <Pressable
              accessibilityLabel="Fermer les options de téléchargement"
              onPress={() => setShowDownloadOptions(false)}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                styles.downloadSheet,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  paddingBottom: insets.bottom + 16,
                },
              ]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
              <View style={styles.sheetHeader}>
                <View style={[styles.sheetIcon, { backgroundColor: colors.secondary }]}>
                  <Ionicons name="download-outline" size={21} color={colors.accent} />
                </View>
                <View style={styles.sheetHeaderCopy}>
                  <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Télécharger le flux</Text>
                  <Text numberOfLines={1} style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
                    {shortenUrl(activeUrl ?? url)}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Fermer"
                  hitSlop={12}
                  onPress={() => setShowDownloadOptions(false)}
                  style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                >
                  <Ionicons name="close" size={22} color={colors.mutedForeground} />
                </Pressable>
              </View>

              <Text style={[styles.sheetHint, { color: colors.mutedForeground }]}>
                Choisissez la méthode qui convient à ce serveur.
              </Text>

              <Pressable
                testID="save-download-option"
                disabled={downloadState === 'working'}
                onPress={() => void downloadSource('save')}
                style={({ pressed }) => [
                  styles.downloadOption,
                  { borderColor: colors.border, backgroundColor: colors.input, opacity: pressed ? 0.72 : 1 },
                ]}
              >
                <View style={[styles.optionIcon, { backgroundColor: colors.secondary }]}>
                  <Ionicons name="folder-open-outline" size={20} color={colors.accent} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={[styles.optionTitle, { color: colors.foreground }]}>
                    {downloadState === 'working' ? 'Téléchargement…' : 'Enregistrer la playlist HLS'}
                  </Text>
                  <Text style={[styles.optionDescription, { color: colors.mutedForeground }]}>
                    Télécharge le fichier .m3u8, puis ouvre le menu iOS pour l’enregistrer dans Fichiers.
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>

              <Pressable
                testID="browser-download-option"
                onPress={() => void downloadSource('browser')}
                style={({ pressed }) => [
                  styles.downloadOption,
                  { borderColor: colors.border, backgroundColor: colors.input, opacity: pressed ? 0.72 : 1 },
                ]}
              >
                <View style={[styles.optionIcon, { backgroundColor: colors.secondary }]}>
                  <Ionicons name="globe-outline" size={20} color={colors.accent} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={[styles.optionTitle, { color: colors.foreground }]}>Ouvrir dans Safari</Text>
                  <Text style={[styles.optionDescription, { color: colors.mutedForeground }]}>
                    À utiliser si le site propose son propre bouton de téléchargement.
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>

              <Pressable
                testID="share-download-option"
                onPress={() => void downloadSource('share')}
                style={({ pressed }) => [
                  styles.downloadOption,
                  { borderColor: colors.border, backgroundColor: colors.input, opacity: pressed ? 0.72 : 1 },
                ]}
              >
                <View style={[styles.optionIcon, { backgroundColor: colors.secondary }]}>
                  <Ionicons name="share-outline" size={20} color={colors.accent} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={[styles.optionTitle, { color: colors.foreground }]}>Partager le lien</Text>
                  <Text style={[styles.optionDescription, { color: colors.mutedForeground }]}>
                    Envoie l’adresse vers une autre app ou un gestionnaire de téléchargement.
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>
        </Modal>

        {state === 'error' && errorMessage ? (
          <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.destructive }]}>
            <View style={[styles.errorIcon, { backgroundColor: `${colors.destructive}20` }]}>
              <Ionicons name="shield-outline" size={21} color={colors.destructive} />
            </View>
            <View style={styles.errorCopy}>
              <Text style={[styles.errorTitle, { color: colors.foreground }]}>{errorTitle}</Text>
              <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
                {errorMessage}{' '}
                {signedUrlExpiry && signedUrlExpiry <= Date.now()
                  ? 'Collez un nouveau lien généré par le site source : une signature expirée ne peut pas être renouvelée par le lecteur.'
                  : 'L’app ne peut pas contourner un accès protégé ou un DRM, mais elle envoie une requête adaptée pour les domaines pris en charge.'}
              </Text>
              <Pressable
                onPress={() => setShowDetails((value) => !value)}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.detailsLink, { color: colors.accent }]}>
                  {showDetails ? 'Masquer le diagnostic' : 'Voir le diagnostic'}
                </Text>
              </Pressable>
              {showDetails ? (
                <Text style={[styles.detailsText, { color: colors.mutedForeground }]}>
                  Essayez un lien encore valide généré par Sibnet. Si le lien fonctionne seulement depuis leur page web, il faut un relais autorisé côté serveur.
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {history.length > 0 ? (
          <View style={styles.historySection}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Récents</Text>
              <Pressable onPress={() => void clearHistory()} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                <Text style={[styles.clearText, { color: colors.mutedForeground }]}>Effacer</Text>
              </Pressable>
            </View>
            {history.map((item) => (
              <Pressable
                key={item}
                testID={`recent-stream-${item}`}
                onPress={() => void openStream(item)}
                style={({ pressed }) => [
                  styles.historyRow,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={[styles.historyIcon, { backgroundColor: colors.secondary }]}>
                  <Ionicons name="play-circle-outline" size={20} color={colors.accent} />
                </View>
                <Text numberOfLines={1} style={[styles.historyText, { color: colors.foreground }]}>
                  {shortenUrl(item)}
                </Text>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.footer}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Lecture locale · aucun lien envoyé ailleurs
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22 },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff725c',
    transform: [{ rotate: '-8deg' }],
  },
  headerText: { flex: 1, marginLeft: 14 },
  eyebrow: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.4 },
  title: { fontSize: 26, lineHeight: 31, fontFamily: 'Inter_700Bold', letterSpacing: -0.8 },
  livePill: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  liveDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  liveText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: 16, marginBottom: 20, paddingHorizontal: 22 },
  playerShell: { marginHorizontal: 18, borderWidth: 1, borderRadius: 24, overflow: 'hidden', aspectRatio: 16 / 10 },
  video: { flex: 1, backgroundColor: '#080a12' },
  emptyPlayer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyIcon: { width: 70, height: 70, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  loadingBadge: { position: 'absolute', top: 12, left: 12, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  loadingBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginTop: 12, minHeight: 22 },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  activeLabel: { flex: 1, fontSize: 12, textAlign: 'right', marginLeft: 12, fontFamily: 'Inter_500Medium' },
  formCard: { margin: 18, marginTop: 15, borderWidth: 1, borderRadius: 22, padding: 16 },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  fieldLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  fieldHint: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  inputWrap: { minHeight: 52, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', paddingHorizontal: 10, paddingVertical: 12 },
  openButton: { minHeight: 52, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 9 },
  actionRow: { flexDirection: 'row', gap: 9 },
  playButton: { flex: 1 },
  downloadButton: { paddingHorizontal: 14, borderWidth: 1, gap: 7 },
  openButtonText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  downloadButtonText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  downloadSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 10 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center' },
  sheetIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  sheetHeaderCopy: { flex: 1 },
  sheetTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  sheetSubtitle: { fontSize: 11, marginTop: 3, fontFamily: 'Inter_500Medium' },
  sheetHint: { fontSize: 12, lineHeight: 18, marginTop: 14, marginBottom: 12 },
  downloadOption: { minHeight: 72, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 10, marginBottom: 8 },
  optionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  optionCopy: { flex: 1, paddingRight: 8 },
  optionTitle: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  optionDescription: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  errorCard: { marginHorizontal: 18, borderWidth: 1, borderRadius: 20, padding: 15, flexDirection: 'row' },
  errorIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  errorCopy: { flex: 1 },
  errorTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  errorText: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  detailsLink: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 8 },
  detailsText: { fontSize: 12, lineHeight: 18, marginTop: 7 },
  historySection: { marginHorizontal: 18, marginTop: 26 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  clearText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  historyRow: { flexDirection: 'row', alignItems: 'center', minHeight: 58, borderWidth: 1, borderRadius: 17, paddingHorizontal: 11, marginBottom: 8 },
  historyIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  historyText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28, gap: 5 },
  footerText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});