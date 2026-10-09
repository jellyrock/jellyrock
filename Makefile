##########################################################################
# Need curl and npm in your $PATH
# If you want to make_images, you'll also need convert from ImageMagick
##########################################################################

VERSION := 1.0.0

## usage

.PHONY: help
help:
	@echo "targets"
	@echo "  build-dev               build development package"
	@echo "  build-prod              build production package"
	@echo "  build-tests             build all tests (unit + integration)"
	@echo "  build-tests-unit        build unit tests only"
	@echo "  build-tests-integration build integration tests only"
	@echo "  build-tdd               build in watch mode for TDD"
	@echo "  format                  format brighscripts"
	@echo "  lint                    lint code and documentation"
	@echo "  make_images             generate branding images from SVGs"
	@echo "targets needing ROKU_DEV_TARGET"
	@echo "  home         press the home button on device"
	@echo "  launch       launch installed"
	@echo "targets needing ROKU_DEV_TARGET and ROKU_DEV_PASSWORD"
	@echo "  install      install on device"
	@echo "  remove       remove installed from device"
	@echo "  screenshot   take a screenshot"
	@echo "  deploy       lint, remove, install"
	@echo "environment"
	@echo "  ROKU_DEV_TARGET with device's IP"
	@echo "  ROKU_DEV_PASSWORD with device's password"

## development

BUILT_PKG := out/jellyrock.zip

node_modules/: package-lock.json; npm ci

.PHONY: build-dev build-prod build-tests build-tests-unit build-tests-integration build-tdd
.NOTPARALLEL: build-dev build-prod build-tests build-tests-unit build-tests-integration build-tdd # output to the same file
build-dev: node_modules/; npm run build
build-prod: node_modules/; npm run build:prod
build-tests: node_modules/; npm run build:tests
build-tests-unit: node_modules/; npm run build:tests-unit
build-tests-integration: node_modules/; npm run build:tests-integration
build-tdd: node_modules/; npm run build:tdd

# default to build-dev + package if file doesn't exist
$(BUILT_PKG):; $(MAKE) build-dev && npm run package

.PHONY: format
format: node_modules/; npm run format

.PHONY: lint
lint: node_modules/; npm run lint

## roku box

CURL_CMD ?= curl --show-error

ifdef ROKU_DEV_TARGET

.PHONY: home launch
home:
	$(CURL_CMD) -XPOST http://$(ROKU_DEV_TARGET):8060/keypress/home
	sleep 2 # wait for device reaction
launch:
	$(CURL_CMD) -XPOST http://$(ROKU_DEV_TARGET):8060/launch/dev

ifdef ROKU_DEV_PASSWORD

CURL_LOGGED_CMD := $(CURL_CMD) --user rokudev:$(ROKU_DEV_PASSWORD) --digest

EXTRACT_ERROR_CMD := grep "<font color" | sed "s/<font color=\"red\">//" | sed "s[</font>[["
.PHONY: install remove
install: $(BUILT_PKG) home
	$(CURL_LOGGED_CMD) -F "mysubmit=Install" -F "archive=@$<" -F "passwd=" http://$(ROKU_DEV_TARGET)/plugin_install | $(EXTRACT_ERROR_CMD)
	$(MAKE) launch
remove:
	$(CURL_LOGGED_CMD) -F "mysubmit=Delete" -F "archive=" -F "passwd=" http://$(ROKU_DEV_TARGET)/plugin_install | $(EXTRACT_ERROR_CMD)

.PHONY: screenshot
screenshot:
	$(CURL_LOGGED_CMD) -F mysubmit=Screenshot "http://$(ROKU_DEV_TARGET)/plugin_inspect"
	$(CURL_LOGGED_CMD) -o screenshot.jpg "http://$(ROKU_DEV_TARGET)/pkgs/dev.jpg"

.PHONY: deploy
.NOTPARALLEL: deploy
deploy: lint remove install

endif # ROKU_DEV_PASSWORD

endif # ROKU_DEV_TARGET

## sync branding

CONVERT_CMD ?= convert -gravity center -density 1200
CONVERT_BLUEBG_CMD := $(CONVERT_CMD) -background "\#0d1117" -density 1200
LOGO := resources/branding/logo.svg
LOGO_SECONDARY := resources/branding/logo-secondary.svg
LOGO_DEV := resources/branding/logo-dev.svg
LOGO_DEV_SECONDARY := resources/branding/logo-dev-secondary.svg
LOGO_JR := resources/branding/logo-jr.svg

# Directory creation rules
images/:; mkdir $@
images/branding/:; mkdir -p $@

# Clean target to remove generated images
.PHONY: clean_images
clean_images:
	rm -f images/branding/*.png
	rm -f resources/branding/release/*.png
	rm -f resources/branding/logo-jr.png

# Image generation rules with force rebuild
images/branding/logo.png: $(LOGO_DEV_SECONDARY) | clean_images ; $(CONVERT_CMD) -background none -resize 180x39 $< $@
images/branding/channel-poster_fhd.png: $(LOGO_DEV) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 432x324 -extent 540x405 $< $@
images/branding/channel-poster_hd.png: $(LOGO_DEV) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 232x174 -extent 290x218 $< $@
images/branding/channel-poster_sd.png: $(LOGO_DEV) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 197x112 -extent 246x140 $< $@
images/branding/splash-screen_fhd.png: $(LOGO_DEV) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 540x540 -extent 1920x1080 $< $@
images/branding/splash-screen_hd.png: $(LOGO_DEV) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 360x360 -extent 1280x720 $< $@
images/branding/splash-screen_sd.png: $(LOGO_DEV) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 240x240 -extent 720x480 $< $@

resources/branding/release/logo.png: $(LOGO_SECONDARY) | clean_images ; $(CONVERT_CMD) -background none -resize 180x39 $< $@
resources/branding/release/channel-poster_fhd.png: $(LOGO) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 432x324 -extent 540x405 $< $@
resources/branding/release/channel-poster_hd.png: $(LOGO) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 232x174 -extent 290x218 $< $@
resources/branding/release/channel-poster_sd.png: $(LOGO) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 197x112 -extent 246x140 $< $@
resources/branding/release/splash-screen_fhd.png: $(LOGO) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 540x540 -extent 1920x1080 $< $@
resources/branding/release/splash-screen_hd.png: $(LOGO) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 360x360 -extent 1280x720 $< $@
resources/branding/release/splash-screen_sd.png: $(LOGO) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 240x240 -extent 720x480 $< $@

resources/branding/logo-jr.png: $(LOGO_JR) | clean_images ; $(CONVERT_BLUEBG_CMD) -resize 96x96 -extent 128x128 $< $@

# Main target with dependency on clean
.PHONY: make_images
make_images: clean_images \
	images/branding/logo.png \
	images/branding/channel-poster_fhd.png \
	images/branding/channel-poster_hd.png \
	images/branding/channel-poster_sd.png \
	images/branding/splash-screen_fhd.png \
	images/branding/splash-screen_hd.png \
	images/branding/splash-screen_sd.png \
	resources/branding/release/logo.png \
	resources/branding/release/channel-poster_fhd.png \
	resources/branding/release/channel-poster_hd.png \
	resources/branding/release/channel-poster_sd.png \
	resources/branding/release/splash-screen_fhd.png \
	resources/branding/release/splash-screen_hd.png \
	resources/branding/release/splash-screen_sd.png \
	resources/branding/logo-jr.png