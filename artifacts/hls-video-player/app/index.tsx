import { Feather, Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
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

export default function PlayerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string>(DEFAULT_URL);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [state, setState] = useState<PlaybackState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

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
        headers: {
          Referer: 'https://video.sibnet.ru/',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        },
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

  const stateCopy = {
    idle: { label: 'Prêt à lire', color: colors.mutedForeground },
    loading: { label: 'Connexion au flux…', color: colors.warning },
    ready: { label: 'Lecture en cours', color: colors.success },
    error: { label: 'Accès refusé ou flux indisponible', color: colors.destructive },
  }[state];

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
          <Pressable
            testID="open-stream-button"
            onPress={() => void openStream()}
            style={({ pressed }) => [
              styles.openButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 },
            ]}
          >
            <Ionicons name="play" size={18} color={colors.primaryForeground} />
            <Text style={[styles.openButtonText, { color: colors.primaryForeground }]}>Lire le flux</Text>
            <Feather name="arrow-up-right" size={17} color={colors.primaryForeground} />
          </Pressable>
        </View>

        {state === 'error' && errorMessage ? (
          <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.destructive }]}>
            <View style={[styles.errorIcon, { backgroundColor: `${colors.destructive}20` }]}>
              <Ionicons name="shield-outline" size={21} color={colors.destructive} />
            </View>
            <View style={styles.errorCopy}>
              <Text style={[styles.errorTitle, { color: colors.foreground }]}>Le serveur a répondu 403</Text>
              <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
                {errorMessage} L’app ne peut pas contourner un accès protégé, une expiration ou un DRM, mais elle envoie une requête iOS adaptée avec le référent du site.
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
  openButtonText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
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