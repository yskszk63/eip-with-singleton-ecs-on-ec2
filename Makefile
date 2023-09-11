cdk = deno task --quiet cdk

.PHONY: synth
synth:
	$(cdk) synth --quiet

.PHONY: diff
diff:
	$(cdk) --app cdk.out diff

.PHONY: deploy
deploy:
	$(cdk) --app cdk.out deploy --all --require-approval=never
