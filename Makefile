# Makefile

# Example usage: make release VERSION=1.0.0

release:
	# Ensure that a version is provided
	if [ -z "$(VERSION)" ]; then echo "VERSION is not set. Usage: make release VERSION=x.y.z"; exit 1; fi
	# Fetch the latest changes from the origin
	git fetch origin
	get rebase origin/main
	# Reset the current branch to match the origin branch
	git reset --hard 
	# Clean untracked files and directories
	git clean -dxf
	# Tag the current commit
	git tag -a "$(VERSION)" -m "Release $(VERSION)"
	# Push the tag to remote repository
	git push origin "$(VERSION)"
	# Publish to npm
	npm run build && npm publish --access public

.PHONY: release
