// Auth models mirroring apps/backend/openapi.json (hand-written; see ADR-006).

typedef Json = Map<String, dynamic>;

/// Which Santha app is calling — decides the role granted on first sign-in.
enum SanthaApp { consumer, merchant, rider }

enum ClientPlatform { android, ios, web }

class OtpChallenge {
  const OtpChallenge({required this.challengeId, required this.expiresInSec, required this.resendAfterSec});

  factory OtpChallenge.fromJson(Json j) => OtpChallenge(
        challengeId: j['challengeId'] as String,
        expiresInSec: j['expiresInSec'] as int,
        resendAfterSec: j['resendAfterSec'] as int,
      );

  final String challengeId;
  final int expiresInSec;
  final int resendAfterSec;
}

class Me {
  const Me({required this.id, required this.phoneMasked, required this.name, required this.locale, required this.roles});

  factory Me.fromJson(Json j) => Me(
        id: j['id'] as String,
        phoneMasked: j['phoneMasked'] as String,
        name: j['name'] as String?,
        locale: j['locale'] as String,
        roles: (j['roles'] as List<dynamic>).cast<String>(),
      );

  final String id;
  final String phoneMasked;
  final String? name;
  final String locale;
  final List<String> roles;

  Json toJson() => {'id': id, 'phoneMasked': phoneMasked, 'name': name, 'locale': locale, 'roles': roles};
}

class TokenPair {
  const TokenPair({
    required this.accessToken,
    required this.refreshToken,
    required this.accessExpiresIn,
    required this.refreshExpiresIn,
  });

  factory TokenPair.fromJson(Json j) => TokenPair(
        accessToken: j['accessToken'] as String,
        refreshToken: j['refreshToken'] as String,
        accessExpiresIn: j['accessExpiresIn'] as int,
        refreshExpiresIn: j['refreshExpiresIn'] as int,
      );

  final String accessToken;
  final String refreshToken;
  final int accessExpiresIn;
  final int refreshExpiresIn;
}

class AuthSession {
  const AuthSession({required this.tokens, required this.user, required this.isNewUser});

  factory AuthSession.fromJson(Json j) => AuthSession(
        tokens: TokenPair.fromJson(j),
        user: Me.fromJson(j['user'] as Json),
        isNewUser: j['isNewUser'] as bool,
      );

  final TokenPair tokens;
  final Me user;
  final bool isNewUser;
}
