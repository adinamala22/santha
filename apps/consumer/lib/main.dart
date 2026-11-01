// Default entry point (`flutter run` without -t) = dev flavor. Use main_stg.dart / main_prod.dart for others.
import 'main_dev.dart' as dev;

Future<void> main() => dev.main();
