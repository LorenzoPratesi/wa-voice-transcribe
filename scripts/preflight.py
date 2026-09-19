#!/usr/bin/env python3
"""Checks that run before the store package is built.

Kept apart from package.sh so the shell script stays free of nested heredocs,
and so these checks can be run on their own.

Usage: preflight.py <packaged file> ...
"""

import json
import pathlib
import re
import sys


def check_manifest():
    manifest = json.load(open('manifest.json'))

    assert manifest['manifest_version'] == 3, 'manifest_version must be 3'

    for size in ('16', '32', '48', '128'):
        assert size in manifest.get('icons', {}), 'missing %spx icon' % size

    locale = manifest.get('default_locale')
    if manifest['name'].startswith('__MSG_'):
        assert locale, 'default_locale is required for a __MSG__ name'

    description = manifest['description']
    if description.startswith('__MSG_'):
        key = description[len('__MSG_'):-len('__')]
        messages = json.load(open('_locales/%s/messages.json' % locale))
        description = messages[key]['message']
    assert len(description) <= 132, \
        'description is %d characters, the store allows 132' % len(description)

    print('  manifest ok — description %d/132 characters' % len(description))


def check_locales():
    """Every locale must carry the same keys, or a translated UI shows raw keys."""
    locales = sorted(p.parent.name for p in pathlib.Path('_locales').glob('*/messages.json'))
    catalogs = {
        name: json.load(open('_locales/%s/messages.json' % name))
        for name in locales
    }
    reference = catalogs[json.load(open('manifest.json'))['default_locale']]

    for name, catalog in catalogs.items():
        missing = sorted(set(reference) - set(catalog))
        assert not missing, '%s is missing: %s' % (name, ', '.join(missing))

        mismatched = sorted(
            key for key in reference
            if ('placeholders' in reference[key]) != ('placeholders' in catalog[key])
        )
        assert not mismatched, '%s has mismatched placeholders: %s' % (name, ', '.join(mismatched))

        # A translator can drop a $TOKEN$ without noticing; the message then
        # renders with a hole in it instead of the number or the error text.
        for key, entry in reference.items():
            for token in entry.get('placeholders', {}):
                marker = '$%s$' % token
                assert marker in catalog[key]['message'], \
                    '%s: %s lost the %s placeholder' % (name, key, marker)

        # The store applies the 132 character limit to each locale's description,
        # not just the default one.
        described = catalog['extDesc']['message']
        assert len(described) <= 132, \
            '%s description is %d characters, the store allows 132' % (name, len(described))

    print('  locales ok — %d messages in %s' % (len(reference), ', '.join(locales)))


def check_imports(packaged):
    """A whitelist guards against shipping too much, never against shipping too
    little: a module that is imported but left out would break the extension
    silently, and only once installed."""
    scripts = {name for name in packaged if name.endswith('.js')}
    missing = []

    for name in sorted(scripts):
        source = pathlib.Path(name).read_text()
        for imported in re.findall(r"from\s+['\"]\./([^'\"]+)['\"]", source):
            if imported not in scripts:
                missing.append('%s imports %s' % (name, imported))

    assert not missing, 'unpackaged imports: %s' % '; '.join(missing)
    print('  imports ok — every module reached from the packaged files is included')


def main():
    try:
        check_manifest()
        check_locales()
        check_imports(sys.argv[1:])
    except AssertionError as failure:
        print('  %s' % failure, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
