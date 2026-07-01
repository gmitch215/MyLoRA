<template>
	<UModal
		:open="open"
		title="New Training Job"
		:class="fullscreen ? 'w-screen h-screen max-w-none! max-h-none!' : 'max-w-3xl w-full'"
		@update:open="onOpenChange"
	>
		<template #header>
			<div class="flex items-center justify-between w-full">
				<h3 class="text-lg font-semibold text-highlighted">
					{{ prefill ? 'Relaunch Training Job' : 'New Training Job' }}
				</h3>
				<div class="flex space-x-2">
					<UButton
						:icon="fullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'"
						color="neutral"
						variant="ghost"
						:title="fullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
						aria-label="Toggle Fullscreen"
						@click="fullscreen = !fullscreen"
					/>
					<UButton
						icon="mdi:close"
						color="neutral"
						variant="ghost"
						title="Close"
						aria-label="Close"
						@click="close"
					/>
				</div>
			</div>
		</template>

		<template #body>
			<UForm
				:state="formState"
				class="space-y-6"
				@submit="onSubmit"
			>
				<UAlert
					v-if="error"
					color="error"
					variant="subtle"
					icon="mdi:alert-circle"
					:title="error"
				/>

				<!-- the engine tab is the doc2lora / peft / accelerate choice -->
				<UTabs
					v-model="engine"
					:items="engineTabs"
					:content="false"
				/>

				<!-- doc2lora: raw documents -> adapter, no labeled dataset -->
				<section
					v-if="engine === 'doc2lora'"
					class="space-y-4"
				>
					<UFormField
						label="Base Model"
						name="baseModel"
						help="Curated Cloudflare base; the model type is set automatically"
					>
						<USelectMenu
							v-model="docBaseModel"
							:items="docBaseModelItems"
							value-key="value"
							placeholder="Select a base model"
							class="w-full"
						/>
					</UFormField>

					<!-- incremental dataset: additive file picker + url loader + per-file delete -->
					<UFormField
						label="Documents"
						name="documents"
						help="Plain text, markdown or document files to learn from. .zip / .tar archives and many files at once are supported."
					>
						<input
							ref="docFileInput"
							type="file"
							multiple
							class="hidden"
							@change="onDocFilesPicked"
						/>
						<div class="flex flex-wrap items-center gap-2">
							<UButton
								color="neutral"
								variant="outline"
								icon="mdi:file-document-multiple"
								:loading="addingFiles"
								:disabled="datasetBusy"
								@click="onChooseFiles"
							>
								Choose Files
							</UButton>
							<span class="text-xs text-muted">
								{{ datasetFiles.length }} File{{ datasetFiles.length === 1 ? '' : 's' }} -
								{{ formatBytes(datasetTotalBytes) }}
							</span>
						</div>
					</UFormField>

					<UFormField
						label="Add From URL"
						name="documentUrl"
						help="Load a remote text, markdown or archive file; the server fetches and validates it"
					>
						<div class="flex flex-wrap items-center gap-2">
							<UInput
								v-model="docUrl"
								icon="mdi:link-variant"
								placeholder="https://example.com/corpus.txt"
								class="min-w-0 flex-1 font-mono"
								:disabled="datasetBusy"
								@keydown.enter.prevent="onAddUrl"
							/>
							<UButton
								color="neutral"
								variant="outline"
								icon="mdi:plus"
								:loading="addingUrl"
								:disabled="!docUrl.trim() || datasetBusy"
								@click="onAddUrl"
							>
								Add
							</UButton>
						</div>
					</UFormField>

					<!-- the live viewing list of dataset files -->
					<div class="rounded-lg border border-default p-3 bg-elevated/30">
						<div
							v-if="!datasetFiles.length"
							class="text-xs text-muted"
						>
							No documents yet. Choose files or add one from a URL.
						</div>
						<ul
							v-else
							class="divide-y divide-default"
						>
							<li
								v-for="f in datasetFiles"
								:key="f.name"
								class="flex items-center justify-between gap-2 py-1.5 text-sm"
							>
								<span class="min-w-0 truncate font-mono text-toned">{{ f.name }}</span>
								<span class="flex shrink-0 items-center gap-2">
									<span class="text-xs text-muted">{{ formatBytes(f.size) }}</span>
									<UButton
										size="xs"
										color="error"
										variant="ghost"
										icon="mdi:trash-can-outline"
										title="Remove"
										aria-label="Remove File"
										:disabled="datasetBusy"
										@click="onRemoveFile(f.name)"
									/>
								</span>
							</li>
						</ul>
					</div>

					<!-- archives are uncompressed on the box, so the real corpus is larger than the upload -->
					<p
						v-if="hasArchive"
						class="text-xs text-muted"
					>
						Archives are uncompressed on the machine, so the actual training corpus (and time) will
						be larger than the upload size.
					</p>

					<!-- which doc2lora parsers to install: trade install size vs supported input formats -->
					<UFormField
						label="Document Parsers"
						name="doc2loraExtras"
						help="Which file types doc2lora can read. Larger scopes install more dependencies."
					>
						<USelect
							v-model="config.doc2loraExtras"
							:items="doc2loraExtrasItems"
							value-key="value"
							class="w-full"
						/>
					</UFormField>
					<UAlert
						v-if="config.doc2loraExtras === 'all'"
						color="warning"
						variant="subtle"
						icon="mdi:alert"
						title="Audio + Video Needs Python <= 3.12"
						description="The 'all' scope pulls numba/llvmlite for audio/video, which cannot build on Python 3.13+. Set the Python version to 3.11 or 3.12 under Advanced if you choose this."
					/>
					<UAlert
						v-if="prepInfo"
						:color="prepInfo.color"
						variant="subtle"
						:icon="
							prepInfo.color === 'success'
								? 'mdi:package-variant-closed-check'
								: prepInfo.color === 'warning'
									? 'mdi:package-variant'
									: 'mdi:package-down'
						"
						:title="prepInfo.title"
						:description="prepInfo.desc"
					/>

					<div class="rounded-lg border border-default p-3 bg-elevated/30">
						<div class="flex items-center gap-2 text-sm">
							<UIcon
								name="mdi:clock-fast"
								class="size-4 text-muted"
							/>
							<span class="text-muted">Estimated Training Time:</span>
							<span class="font-medium text-highlighted">{{ etaLabel }}</span>
						</div>
						<p class="mt-1 text-xs text-muted">
							Order-of-magnitude planning hint from corpus size, base model and device; wide error
							bars.
						</p>
					</div>
				</section>

				<!-- peft: free hf base model + a hf dataset (searched or typed) -->
				<section
					v-else-if="engine === 'peft'"
					class="space-y-4"
				>
					<UFormField
						label="Base Model"
						name="peftBaseModel"
						help="Any HuggingFace model id - type your own or pick a suggested Cloudflare base"
					>
						<UInputMenu
							v-model="peftBaseModel"
							:items="cfModelSuggestions"
							create-item="always"
							placeholder="mistralai/Mistral-7B-Instruct-v0.2"
							class="w-full font-mono"
						/>
					</UFormField>
					<div class="-mt-2">
						<UBadge
							v-if="peftModelType"
							color="success"
							variant="subtle"
							size="sm"
							icon="mdi:cloud-check"
						>
							Cloudflare-deployable ({{ peftModelType }})
						</UBadge>
						<UBadge
							v-else
							color="warning"
							variant="subtle"
							size="sm"
							icon="mdi:download"
						>
							Download-only (Not a CF Base)
						</UBadge>
					</div>

					<UFormField
						label="HuggingFace Dataset"
						name="hfDataset"
						help="Search the public catalog or type a dataset id directly"
					>
						<div class="relative">
							<UInput
								v-model="hfQuery"
								icon="mdi:magnify"
								placeholder="Search datasets, e.g. databricks/databricks-dolly-15k"
								class="w-full font-mono"
								:loading="hfSearching"
								@blur="onHfQueryBlur"
								@input="onHfQueryInput"
							/>
							<div
								v-if="showHfResults && hfResults.length"
								class="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-default bg-default shadow-lg"
							>
								<button
									v-for="r in hfResults"
									:key="r.id"
									type="button"
									class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-elevated/50"
									@mousedown.prevent="pickHfDataset(r.id)"
								>
									<span class="min-w-0 truncate font-mono text-toned">{{ r.id }}</span>
									<span class="flex shrink-0 items-center gap-2">
										<UBadge
											v-if="r.gated"
											color="warning"
											variant="subtle"
											size="sm"
											icon="mdi:lock"
										>
											Gated
										</UBadge>
										<span class="inline-flex items-center gap-1 text-xs text-muted">
											<UIcon
												name="mdi:download"
												class="size-3"
											/>
											{{ formatCount(r.downloads) }}
										</span>
									</span>
								</button>
							</div>
						</div>

						<div
							v-if="config.hfDataset"
							class="mt-2 text-xs"
						>
							<span
								v-if="hfValidating"
								class="inline-flex items-center gap-1 text-muted"
							>
								<AppSpinner size="sm" />
								Validating {{ config.hfDataset }}...
							</span>
							<span
								v-else-if="hfStatus === 'valid'"
								class="inline-flex items-center gap-1 text-success"
							>
								<UIcon
									name="mdi:check-circle"
									class="size-3.5"
								/>
								{{ config.hfDataset }} is available
							</span>
							<span
								v-else-if="hfStatus === 'gated'"
								class="inline-flex items-center gap-1 text-warning"
							>
								<UIcon
									name="mdi:lock"
									class="size-3.5"
								/>
								{{ config.hfDataset }} is gated - needs an HF token below
							</span>
							<span
								v-else-if="hfStatus === 'missing'"
								class="inline-flex items-center gap-1 text-error"
							>
								<UIcon
									name="mdi:alert-circle"
									class="size-3.5"
								/>
								{{ config.hfDataset }} was not found
							</span>
						</div>
					</UFormField>

					<div class="grid gap-4 sm:grid-cols-2">
						<UFormField
							label="Split"
							name="hfSplit"
						>
							<UInput
								v-model="config.hfSplit"
								placeholder="train"
								class="w-full font-mono"
							/>
						</UFormField>
						<UFormField
							label="Config"
							name="hfConfig"
							help="Optional dataset config name"
						>
							<UInput
								v-model="config.hfConfig"
								placeholder="default"
								class="w-full font-mono"
							/>
						</UFormField>
					</div>

					<div class="space-y-3 rounded-lg border border-default p-3 bg-elevated/30">
						<p class="text-xs text-muted">
							Use a single text column OR a {column} template to build each training example.
						</p>
						<div class="grid gap-4 sm:grid-cols-2">
							<UFormField
								label="Text Column"
								name="textField"
							>
								<UInput
									v-model="config.textField"
									placeholder="text"
									class="w-full font-mono"
								/>
							</UFormField>
							<UFormField
								label="Format Template"
								name="textTemplate"
							>
								<UTextarea
									v-model="config.textTemplate"
									:rows="2"
									placeholder="{instruction}&#10;&#10;{response}"
									class="w-full font-mono"
								/>
							</UFormField>
						</div>
					</div>

					<UAlert
						color="info"
						variant="subtle"
						icon="mdi:language-python"
						title="Generated PEFT Script"
						description="Run trains a generated PEFT python file (AutoModelForCausalLM + LoraConfig + Trainer) on your machine."
					/>
				</section>

				<!-- accelerate: diffusers text-to-image LoRA via `accelerate launch` (always download-only) -->
				<section
					v-else
					class="space-y-4"
				>
					<UFormField
						label="Base Model"
						name="accelBaseModel"
						help="A diffusion model id (Stable Diffusion). Trains an image LoRA - download only, not Cloudflare-deployable."
					>
						<UInputMenu
							v-model="accelBaseModel"
							:items="diffusionSuggestions"
							create-item="always"
							placeholder="stabilityai/stable-diffusion-2-1"
							class="w-full font-mono"
						/>
					</UFormField>
					<div class="-mt-2">
						<UBadge
							color="warning"
							variant="subtle"
							size="sm"
							icon="mdi:download"
						>
							Download-only (Image LoRA)
						</UBadge>
					</div>

					<UFormField
						label="HuggingFace Dataset"
						name="accelHfDataset"
						help="An image + caption dataset; search the public catalog or type a dataset id directly"
					>
						<div class="relative">
							<UInput
								v-model="hfQuery"
								icon="mdi:magnify"
								placeholder="Search datasets, e.g. lambdalabs/pokemon-blip-captions"
								class="w-full font-mono"
								:loading="hfSearching"
								@blur="onHfQueryBlur"
								@input="onHfQueryInput"
							/>
							<div
								v-if="showHfResults && hfResults.length"
								class="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-default bg-default shadow-lg"
							>
								<button
									v-for="r in hfResults"
									:key="r.id"
									type="button"
									class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-elevated/50"
									@mousedown.prevent="pickHfDataset(r.id)"
								>
									<span class="min-w-0 truncate font-mono text-toned">{{ r.id }}</span>
									<span class="flex shrink-0 items-center gap-2">
										<UBadge
											v-if="r.gated"
											color="warning"
											variant="subtle"
											size="sm"
											icon="mdi:lock"
										>
											Gated
										</UBadge>
										<span class="inline-flex items-center gap-1 text-xs text-muted">
											<UIcon
												name="mdi:download"
												class="size-3"
											/>
											{{ formatCount(r.downloads) }}
										</span>
									</span>
								</button>
							</div>
						</div>

						<div
							v-if="config.hfDataset"
							class="mt-2 text-xs"
						>
							<span
								v-if="hfValidating"
								class="inline-flex items-center gap-1 text-muted"
							>
								<AppSpinner size="sm" />
								Validating {{ config.hfDataset }}...
							</span>
							<span
								v-else-if="hfStatus === 'valid'"
								class="inline-flex items-center gap-1 text-success"
							>
								<UIcon
									name="mdi:check-circle"
									class="size-3.5"
								/>
								{{ config.hfDataset }} is available
							</span>
							<span
								v-else-if="hfStatus === 'gated'"
								class="inline-flex items-center gap-1 text-warning"
							>
								<UIcon
									name="mdi:lock"
									class="size-3.5"
								/>
								{{ config.hfDataset }} is gated - needs an HF token below
							</span>
							<span
								v-else-if="hfStatus === 'missing'"
								class="inline-flex items-center gap-1 text-error"
							>
								<UIcon
									name="mdi:alert-circle"
									class="size-3.5"
								/>
								{{ config.hfDataset }} was not found
							</span>
						</div>
					</UFormField>

					<div class="grid gap-4 sm:grid-cols-2">
						<UFormField
							label="Split"
							name="accelHfSplit"
						>
							<UInput
								v-model="config.hfSplit"
								placeholder="train"
								class="w-full font-mono"
							/>
						</UFormField>
						<UFormField
							label="Caption Column"
							name="captionColumn"
							help="the dataset column with the image captions"
						>
							<UInput
								v-model="config.captionColumn"
								placeholder="text"
								class="w-full font-mono"
							/>
						</UFormField>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<UFormField
							label="Resolution"
							name="resolution"
							help="square training resolution in pixels"
						>
							<UInput
								v-model.number="config.resolution"
								type="number"
								:min="64"
								:max="2048"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							label="Max Steps"
							name="maxSteps"
							help="optional cap on training steps"
						>
							<UInput
								v-model.number="config.maxSteps"
								type="number"
								:min="1"
								:max="200000"
								placeholder="1000"
								class="w-full"
							/>
						</UFormField>
					</div>

					<UAlert
						color="info"
						variant="subtle"
						icon="mdi:image-multiple"
						title="Diffusers Text-To-Image LoRA"
						description="Runs `accelerate launch` with the official diffusers text-to-image LoRA script. Output is pytorch_lora_weights.safetensors (download only)."
					/>
				</section>

				<!-- non-blocking gated-model warning; launch is still allowed -->
				<UAlert
					v-if="modelGated"
					color="warning"
					variant="subtle"
					icon="mdi:lock-alert"
					title="Gated Model"
				>
					<template #description>
						{{ gatedModelId }} is a gated HuggingFace model. Accept its license and request access,
						then provide a token with access below (or set one on the machine).
						<UButton
							:to="`https://huggingface.co/${gatedModelId}`"
							target="_blank"
							rel="noopener"
							color="warning"
							variant="link"
							size="sm"
							icon="mdi:open-in-new"
							class="mt-1 -ml-2.5"
						>
							Accept License On HuggingFace
						</UButton>
					</template>
				</UAlert>

				<!-- shared: machine + live connection ping -->
				<section class="space-y-3">
					<UFormField
						label="Machine"
						name="machineId"
					>
						<USelectMenu
							v-model="machineId"
							:items="machineItems"
							value-key="value"
							placeholder="Select a machine"
							class="w-full"
							:disabled="!machines.length"
						/>
						<template
							v-if="!machines.length"
							#help
						>
							<span class="text-xs text-muted">
								No machines yet -
								<NuxtLink
									to="/dashboard/machines"
									class="text-primary underline"
								>
									add one first </NuxtLink
								>.
							</span>
						</template>
					</UFormField>

					<!-- auto connection ping result; refreshes health + gpu for the eta -->
					<div
						v-if="machineId"
						class="rounded-lg border border-default p-3 bg-elevated/30"
					>
						<div
							v-if="pinging"
							class="inline-flex items-center gap-2 text-sm text-muted"
						>
							<AppSpinner size="md" />
							Checking connection...
						</div>
						<TrainingTestConnectionResult
							v-else-if="diagnosis"
							:diagnosis="diagnosis"
						/>
					</div>
				</section>

				<!-- output adapter (optional; applies to every engine) -->
				<section class="grid gap-4 sm:grid-cols-2">
					<UFormField
						label="Output Adapter Name"
						name="outputName"
						help="Display name for the adapter this job creates. Leave blank for the default."
					>
						<UInput
							v-model="config.outputName"
							:placeholder="outputNamePlaceholder"
							class="w-full"
						/>
					</UFormField>
					<UFormField
						label="Output Slug"
						name="outputSlug"
						help="URL slug; lowercase letters, numbers and hyphens. Leave blank for the default."
					>
						<UInput
							v-model="config.outputSlug"
							placeholder="trained-..."
							class="w-full font-mono"
						/>
					</UFormField>
				</section>

				<!-- advanced (hidden by default) -->
				<section class="space-y-3 rounded-lg border border-default p-4 bg-elevated/30">
					<UButton
						color="neutral"
						variant="ghost"
						size="sm"
						:icon="showAdvanced ? 'mdi:chevron-down' : 'mdi:chevron-right'"
						class="-ml-2"
						@click="showAdvanced = !showAdvanced"
					>
						Advanced Configuration (Optional)
					</UButton>

					<div
						v-if="showAdvanced"
						class="space-y-4 pt-2"
					>
						<div class="grid gap-4 sm:grid-cols-3">
							<UFormField
								label="Rank"
								:help="`1-${CF_MAX_RANK}`"
							>
								<UInput
									v-model.number="config.rank"
									type="number"
									:min="1"
									:max="CF_MAX_RANK"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Epochs">
								<UInput
									v-model.number="config.epochs"
									type="number"
									:min="1"
									:max="20"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Learning Rate">
								<UInput
									v-model.number="config.learningRate"
									type="number"
									step="any"
									:min="0.000001"
									:max="0.01"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="LoRA Alpha">
								<UInput
									v-model.number="config.loraAlpha"
									type="number"
									:min="1"
									:max="256"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="LoRA Dropout">
								<UInput
									v-model.number="config.loraDropout"
									type="number"
									step="any"
									:min="0"
									:max="0.9"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Max Length">
								<UInput
									v-model.number="config.maxLength"
									type="number"
									:min="16"
									:max="4096"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Batch Size">
								<UInput
									v-model.number="config.batchSize"
									type="number"
									:min="1"
									:max="32"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Gradient Accumulation Steps">
								<UInput
									v-model.number="config.gradientAccumulationSteps"
									type="number"
									:min="1"
									:max="64"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Device">
								<USelect
									v-model="config.device"
									:items="deviceItems"
									value-key="value"
									class="w-full"
								/>
							</UFormField>
						</div>

						<UFormField
							label="Target Modules"
							help="Comma-separated; leave blank to auto-detect"
						>
							<UInput
								v-model="targetModulesText"
								placeholder="q_proj, v_proj"
								class="w-full font-mono"
							/>
						</UFormField>

						<div class="flex flex-col gap-3 sm:flex-row sm:gap-6">
							<USwitch
								v-model="config.load4bit"
								label="Load In 4-bit (QLoRA)"
								description="Fits larger models on smaller GPUs"
							/>
							<USwitch
								v-model="config.abortOnError"
								label="Abort On Error"
								description="Stop the run on the first non-zero exit"
							/>
						</div>

						<!-- run isolation: an on-box venv (recommended) created with uv -->
						<div class="space-y-3 rounded-lg border border-default p-3 bg-elevated/30">
							<h5 class="text-sm font-semibold text-highlighted">Run Isolation</h5>
							<USwitch
								v-model="config.useVenv"
								label="Use Python venv"
								description="Creates an isolated venv on the machine (recommended; uses uv, auto-installs Python)"
							/>
							<UFormField
								v-if="config.useVenv"
								label="Python Version"
								help="uv installs this managed CPython; 3.11 or 3.12 has the widest ML wheel coverage"
							>
								<UInput
									v-model="config.pythonVersion"
									placeholder="3.11"
									class="w-full font-mono sm:max-w-40"
								/>
							</UFormField>
							<USwitch
								v-model="config.useSudo"
								label="Run With Sudo"
								description="Runs the training process elevated (for hardware/driver access). Setup still runs as your user."
							/>
							<!-- ephemeral sudo creds: neither is persisted; username prefills to the ssh user, the
								password defaults to the machine's ssh password server-side when blank -->
							<div
								v-if="config.useSudo"
								class="grid gap-4 sm:grid-cols-2"
							>
								<UFormField
									label="Sudo Username"
									help="Defaults to the SSH user; change it to run as a different user"
								>
									<UInput
										v-model="sudoUser"
										autocomplete="off"
										:placeholder="selectedMachine?.username || 'root'"
										class="w-full font-mono"
									/>
								</UFormField>
								<UFormField
									label="Sudo Password"
									help="Blank uses the machine's SSH password. Sent only to launch; never stored."
								>
									<UInput
										v-model="sudoPassword"
										type="password"
										autocomplete="off"
										placeholder="sudo password"
										class="w-full font-mono"
									/>
								</UFormField>
							</div>
						</div>

						<!-- peft-only: a custom script that replaces the generated one -->
						<template v-if="engine === 'peft'">
							<UFormField
								label="Custom PEFT Script (Advanced)"
								help="Overrides the generated script. Runs your code on your machine with your account's permissions; only paste code you trust."
							>
								<UTextarea
									v-model="config.pythonFile"
									:rows="8"
									placeholder="# train.py"
									class="w-full font-mono"
								/>
							</UFormField>
						</template>
					</div>
				</section>

				<!-- post-success options (not applicable to accelerate; it is never CF-deployable) -->
				<section
					v-if="engine !== 'accelerate'"
					class="space-y-3 rounded-lg border border-default p-4 bg-elevated/50"
				>
					<h4 class="text-sm font-semibold text-highlighted">After Training</h4>
					<UAlert
						v-if="!canPublish"
						color="neutral"
						variant="subtle"
						icon="mdi:lock-outline"
						title="Publishing Disabled"
						description="You do not have the Publish capability, so auto-publish and finetune upload are unavailable."
					/>
					<USwitch
						v-model="autoPublish"
						label="Auto-Publish On Success"
						description="List the resulting adapter automatically"
						:disabled="!canPublish"
					/>
					<div class="space-y-1">
						<USwitch
							v-model="autoUploadFinetune"
							label="Auto-Upload Finetune To Cloudflare"
							description="Push the adapter to a Cloudflare account's finetune catalog"
							:disabled="!canUploadFinetune"
						/>
						<p
							v-if="canPublish && engine === 'peft' && !peftModelType"
							class="pl-11 text-xs text-warning"
						>
							Base is not Cloudflare-deployable.
						</p>
					</div>
					<UFormField
						v-if="autoUploadFinetune && canUploadFinetune && accountItems.length"
						label="Cloudflare Account"
						help="Where to upload the finetune"
					>
						<USelectMenu
							v-model="accountId"
							:items="accountItems"
							value-key="value"
							placeholder="Select an account"
							class="w-full"
						/>
					</UFormField>
				</section>

				<!-- hf token: gated models / private datasets -->
				<UFormField
					v-if="showHfToken"
					label="HuggingFace Token (Optional)"
					name="hfToken"
					help="Needed for gated models (Llama/Mistral/Gemma) or private datasets. Stored encrypted."
				>
					<UInput
						v-model="hfToken"
						type="password"
						autocomplete="off"
						placeholder="hf_..."
						class="w-full font-mono"
					/>
					<!-- the box already exposes a token env var; pasting one is optional -->
					<UAlert
						v-if="machineProvidesHfToken"
						class="mt-2"
						color="info"
						variant="subtle"
						icon="mdi:key-variant"
						title="This Machine Already Provides a Token"
						:description="`Detected ${machineHfTokenEnv.join(', ')} on the machine; it will be used automatically if you leave this blank.`"
					/>
				</UFormField>

				<div class="flex flex-wrap justify-end gap-2 border-t border-default pt-4">
					<UButton
						color="neutral"
						variant="outline"
						:disabled="submitting"
						@click="close"
					>
						Cancel
					</UButton>
					<UButton
						type="submit"
						icon="mdi:rocket-launch"
						:loading="submitting"
						:disabled="!canSubmit"
					>
						{{ prefill ? 'Relaunch Training' : 'Start Training' }}
					</UButton>
				</div>
			</UForm>
		</template>
	</UModal>
</template>

<script setup lang="ts">
import type { FormSubmitEvent } from '#ui/types';
import { useDebounceFn } from '@vueuse/core';

const props = defineProps<{ open: boolean; prefill?: TrainingJobView | null }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; submit: [id: string] }>();

const jobs = useTrainingJobsStore();
const machinesStore = useMachinesStore();
const cf = useCfAccountsStore();
const auth = useAuthStore();
const toast = useToast();

const fullscreen = ref(false);
const showAdvanced = ref(false);
const submitting = ref(false);
const error = ref('');

const canPublish = computed(() => auth.can('canPublish'));
const machines = computed(() => machinesStore.machines);

// the engine tab is the doc2lora / peft / accelerate choice
const engine = ref<(typeof TRAINING_ENGINES)[number]>('doc2lora');
const engineTabs = [
	{ label: 'Documents (doc2lora)', value: 'doc2lora' },
	{ label: 'PEFT', value: 'peft' },
	{ label: 'Accelerate', value: 'accelerate' }
];

const machineId = ref('');
const autoPublish = ref(false);
const autoUploadFinetune = ref(false);
const accountId = ref('');
const hfToken = ref('');
// ephemeral; sent only to launch a run, never stored or prefilled
const sudoPassword = ref('');
const sudoUser = ref('');

// per-engine base model: doc2lora picks a curated CF base; peft + accelerate are free ids
const docBaseModel = ref(DEFAULT_BASE_MODELS[0]?.model ?? '');
const peftBaseModel = ref('');
const accelBaseModel = ref('');

// advanced config; defaults mirror trainingConfigSchema
const config = reactive({
	rank: 8,
	loraAlpha: 16,
	loraDropout: 0.1,
	epochs: 3,
	learningRate: 0.0005,
	maxLength: 512,
	batchSize: 4,
	gradientAccumulationSteps: 1,
	load4bit: false,
	device: 'auto' as (typeof TRAINING_DEVICES)[number],
	pythonFile: '',
	abortOnError: true,
	hfDataset: '',
	hfConfig: '',
	hfSplit: 'train',
	textField: '',
	textTemplate: '',
	captionColumn: '',
	resolution: 512,
	maxSteps: undefined as number | undefined,
	useVenv: true,
	pythonVersion: '3.11',
	useSudo: false,
	doc2loraExtras: 'docs' as 'core' | 'docs' | 'all',
	// optional output adapter overrides; blank -> server defaults
	outputName: '',
	outputSlug: ''
});
const targetModulesText = ref('');

// a state object so UForm has something to track
const formState = reactive({ engine, machineId });

onMounted(() => {
	if (!machinesStore.machines.length) machinesStore.fetch().catch(() => {});
	if (canPublish.value && !cf.accounts.length) cf.fetch().catch(() => {});
});

// doc2lora parser scope: smaller install vs more supported input formats. the value type is the
// literal union (not widened string) so it matches config.doc2loraExtras on the USelect v-model
const doc2loraExtrasItems: { label: string; value: 'core' | 'docs' | 'all' }[] = [
	{ label: 'Documents (Recommended)', value: 'docs' },
	{ label: 'Plain Text Only (Smallest)', value: 'core' },
	{ label: 'All (Adds Audio + Video)', value: 'all' }
];

const deviceItems = TRAINING_DEVICES.map((d) => ({
	label: d === 'auto' ? 'Auto' : d.toUpperCase(),
	value: d
}));

const machineItems = computed(() =>
	machines.value.map((m) => ({ label: `${m.label} (${m.healthStatus})`, value: m.id }))
);
const docBaseModelItems = computed(() =>
	DEFAULT_BASE_MODELS.map((m) => ({ label: m.model.split('/').pop() || m.model, value: m.model }))
);
// editable PEFT base-model combobox: suggest the curated CF bases, allow any typed HF id
const cfModelSuggestions = DEFAULT_BASE_MODELS.map((m) => m.model);
// a few common diffusion bases for the accelerate combobox (any typed id allowed)
const diffusionSuggestions = [
	'stable-diffusion-v1-5/stable-diffusion-v1-5',
	'stabilityai/stable-diffusion-2-1',
	'stabilityai/sdxl-turbo'
];
const accountItems = computed(() => cf.accounts.map((a) => ({ label: a.label, value: a.id })));

// the active base model depends on the engine tab
const baseModel = computed(() =>
	engine.value === 'peft'
		? peftBaseModel.value
		: engine.value === 'accelerate'
			? accelBaseModel.value
			: docBaseModel.value
);

// peft: detect a CF model type from the free hf id (null -> download-only)
const peftModelType = computed(() => detectModelType(peftBaseModel.value));

// doc2lora: the curated base carries an explicit model type
const docModelType = computed(
	() => DEFAULT_BASE_MODELS.find((m) => m.model === docBaseModel.value)?.modelType
);

// finetune upload needs publish + a cf-deployable base (never for accelerate image LoRAs)
const canUploadFinetune = computed(
	() =>
		canPublish.value &&
		(engine.value === 'doc2lora' || (engine.value === 'peft' && !!peftModelType.value))
);
watch(canUploadFinetune, (ok) => {
	if (!ok) autoUploadFinetune.value = false;
});
// accelerate is never CF-deployable -> force the after-training options off
watch(engine, (e) => {
	if (e === 'accelerate') {
		autoPublish.value = false;
		autoUploadFinetune.value = false;
	}
});

// hf token field shows for peft/accelerate, or for a doc2lora base that could be gated
const docBaseGated = computed(() => {
	const t = docModelType.value;
	return t === 'llama' || t === 'mistral' || t === 'gemma';
});
const showHfToken = computed(() => engine.value !== 'doc2lora' || docBaseGated.value);

// ---- doc2lora incremental dataset (lazy create + additive picker + url + delete) ----
const docFileInput = ref<HTMLInputElement | null>(null);
const docUrl = ref('');
const datasetId = ref('');
const datasetFiles = ref<{ name: string; size: number }[]>([]);
const datasetTotalBytes = ref(0);
const creatingDataset = ref(false);
const addingFiles = ref(false);
const addingUrl = ref(false);
const removingFile = ref(false);
const datasetBusy = computed(
	() => creatingDataset.value || addingFiles.value || addingUrl.value || removingFile.value
);

const ARCHIVE_RE = /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|7z|gz|bz2|xz)$/i;
const hasArchive = computed(() => datasetFiles.value.some((f) => ARCHIVE_RE.test(f.name)));

type DatasetSummary = {
	datasetId: string;
	files: { name: string; size: number }[];
	size: number;
	fileCount: number;
};

function applySummary(s: DatasetSummary) {
	datasetId.value = s.datasetId;
	datasetFiles.value = s.files ?? [];
	datasetTotalBytes.value = s.size ?? 0;
}

// lazily create the dataset the picker then mutates
async function ensureDataset() {
	if (datasetId.value) return datasetId.value;
	creatingDataset.value = true;
	try {
		const s = await jobs.createDataset();
		applySummary(s);
		return datasetId.value;
	} finally {
		creatingDataset.value = false;
	}
}

async function onChooseFiles() {
	await ensureDataset();
	docFileInput.value?.click();
}

async function onDocFilesPicked(e: Event) {
	const input = e.target as HTMLInputElement;
	const files = input.files ? Array.from(input.files) : [];
	if (!files.length) return;
	addingFiles.value = true;
	error.value = '';
	try {
		const id = await ensureDataset();
		applySummary(await jobs.addDatasetFiles(id, files));
		toast.add({ title: 'Documents Added', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		error.value = e?.data?.message ?? e?.message ?? 'Adding files failed';
	} finally {
		addingFiles.value = false;
		// reset so re-picking the same files fires change again
		if (docFileInput.value) docFileInput.value.value = '';
	}
}

async function onAddUrl() {
	const url = docUrl.value.trim();
	if (!url) return;
	addingUrl.value = true;
	error.value = '';
	try {
		const id = await ensureDataset();
		applySummary(await jobs.addDatasetUrl(id, url, config.doc2loraExtras));
		docUrl.value = '';
		toast.add({ title: 'URL Added', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		const msg = e?.data?.message ?? e?.message ?? 'Could not add that URL';
		toast.add({ title: 'URL Not Added', description: msg, color: 'error', icon: 'mdi:alert' });
	} finally {
		addingUrl.value = false;
	}
}

async function onRemoveFile(name: string) {
	if (!datasetId.value) return;
	removingFile.value = true;
	try {
		applySummary(await jobs.removeDatasetFile(datasetId.value, name));
	} catch (e: any) {
		toast.add({
			title: e?.data?.message ?? 'Remove failed',
			color: 'error',
			icon: 'mdi:alert'
		});
	} finally {
		removingFile.value = false;
	}
}

// ---- auto connection ping ----
const pinging = ref(false);
const diagnosis = ref<ConnectionDiagnosis | null>(null);
let pingInFlightFor = '';

async function pingMachine(id: string) {
	if (!id) return;
	// guard against spamming the same machine
	if (pingInFlightFor === id) return;
	pingInFlightFor = id;
	pinging.value = true;
	try {
		diagnosis.value = await machinesStore.test(id);
	} catch (e: any) {
		diagnosis.value = {
			ok: false,
			code: 'unknown',
			message: e?.data?.message ?? e?.message ?? 'Connection test failed'
		};
	} finally {
		pinging.value = false;
		pingInFlightFor = '';
	}
	return diagnosis.value;
}

// re-ping whenever the selected machine changes
watch(machineId, (id) => {
	diagnosis.value = null;
	if (id) pingMachine(id);
});

// ---- hf dataset search + validate (shared by peft + accelerate) ----
const hfQuery = ref('');
const hfSearching = ref(false);
const hfResults = ref<{ id: string; gated: boolean; downloads: number; likes: number }[]>([]);
const showHfResults = ref(false);
const hfValidating = ref(false);
const hfStatus = ref<'valid' | 'gated' | 'missing' | null>(null);

const runHfSearch = useDebounceFn(async (q: string) => {
	if (!q.trim()) {
		hfResults.value = [];
		return;
	}
	hfSearching.value = true;
	try {
		hfResults.value = await jobs.hfSearch(q);
		showHfResults.value = true;
	} finally {
		hfSearching.value = false;
	}
}, 300);

function onHfQueryInput() {
	showHfResults.value = true;
	runHfSearch(hfQuery.value);
}

function pickHfDataset(id: string) {
	config.hfDataset = id;
	hfQuery.value = id;
	showHfResults.value = false;
	hfResults.value = [];
	validateHfDataset(id);
}

// blur: if the typed query is a plausible dataset id, treat it as the chosen one
function onHfQueryBlur() {
	// let a result mousedown register before hiding the list
	setTimeout(() => (showHfResults.value = false), 150);
	const q = hfQuery.value.trim();
	if (q && q !== config.hfDataset && q.includes('/')) {
		config.hfDataset = q;
		validateHfDataset(q);
	}
}

async function validateHfDataset(id: string) {
	hfValidating.value = true;
	hfStatus.value = null;
	try {
		const res = await jobs.hfValidateDataset(id);
		hfStatus.value = res.gated ? 'gated' : res.valid ? 'valid' : 'missing';
	} catch {
		hfStatus.value = 'missing';
	} finally {
		hfValidating.value = false;
	}
}

// ---- hf base-model gated-access check (non-blocking warning) ----
// the curated doc2lora base maps to an HF repo via hfModelFor; peft/accelerate bases are already HF ids
const resolvedHfModel = computed(() => {
	const base = baseModel.value?.trim();
	return base ? hfModelFor(base) : '';
});
const modelGated = ref(false);
const gatedModelId = ref('');

const runModelCheck = useDebounceFn(async (id: string) => {
	if (!id) {
		modelGated.value = false;
		gatedModelId.value = '';
		return;
	}
	try {
		const res = await jobs.hfValidateModel(id);
		// ignore a stale response if the base model changed mid-flight
		if (id !== resolvedHfModel.value) return;
		modelGated.value = res.gated;
		gatedModelId.value = res.gated ? id : '';
	} catch {
		modelGated.value = false;
		gatedModelId.value = '';
	}
}, 400);

// re-check whenever the resolved base model changes (covers all three engines)
watch(
	resolvedHfModel,
	(id) => {
		modelGated.value = false;
		gatedModelId.value = '';
		runModelCheck(id);
	},
	{ immediate: true }
);

// ---- machine-provided hf token (preflight) ----
// var names the box already exposes (HF_TOKEN/HF_API_KEY/...); when set a pasted token is optional
const machineHfTokenEnv = computed(() => selectedMachine.value?.systemInfo?.hfTokenEnv ?? []);
const machineProvidesHfToken = computed(() => machineHfTokenEnv.value.length > 0);

// compact download counts in the search results
function formatCount(n: number) {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return `${n}`;
}

// ---- prefill (relaunch) ----
// hydrate every field from a prior job so the user can tweak + relaunch a new job
async function applyPrefill(job: TrainingJobView) {
	engine.value = job.engine;
	machineId.value = machines.value.some((m) => m.id === job.machineId) ? (job.machineId ?? '') : '';

	const c = job.config;
	if (job.engine === 'peft') peftBaseModel.value = c.baseModel;
	else if (job.engine === 'accelerate') accelBaseModel.value = c.baseModel;
	else docBaseModel.value = c.baseModel;

	config.rank = c.rank;
	config.loraAlpha = c.loraAlpha;
	config.loraDropout = c.loraDropout;
	config.epochs = c.epochs;
	config.learningRate = c.learningRate;
	config.maxLength = c.maxLength;
	config.batchSize = c.batchSize;
	config.gradientAccumulationSteps = c.gradientAccumulationSteps;
	config.load4bit = c.load4bit;
	config.device = c.device;
	config.abortOnError = c.abortOnError;
	config.pythonFile = c.pythonFile ?? '';
	config.hfDataset = c.hfDataset ?? '';
	config.hfConfig = c.hfConfig ?? '';
	config.hfSplit = c.hfSplit ?? 'train';
	config.textField = c.textField ?? '';
	config.textTemplate = c.textTemplate ?? '';
	config.captionColumn = c.captionColumn ?? '';
	config.resolution = c.resolution ?? 512;
	config.maxSteps = c.maxSteps ?? undefined;
	config.useVenv = c.useVenv ?? true;
	config.pythonVersion = c.pythonVersion ?? '3.11';
	config.useSudo = c.useSudo ?? false;
	config.doc2loraExtras = c.doc2loraExtras ?? 'docs';
	config.outputName = c.outputName ?? '';
	config.outputSlug = c.outputSlug ?? '';
	sudoPassword.value = '';
	sudoUser.value = '';
	targetModulesText.value = (c.targetModules ?? []).join(', ');

	autoPublish.value = job.engine !== 'accelerate' && job.autoPublish;
	autoUploadFinetune.value = job.engine !== 'accelerate' && job.autoUploadFinetune;
	accountId.value = job.accountId ?? '';
	hfToken.value = '';

	// mirror the hf picker to the prefilled dataset (and re-validate it)
	hfResults.value = [];
	showHfResults.value = false;
	hfStatus.value = null;
	hfQuery.value = config.hfDataset;
	if (config.hfDataset) validateHfDataset(config.hfDataset);

	// doc2lora: reuse the existing dataset + load its files so the user can add/remove more
	datasetId.value = '';
	datasetFiles.value = [];
	datasetTotalBytes.value = 0;
	if (job.engine === 'doc2lora' && job.datasetId) {
		datasetId.value = job.datasetId;
		try {
			applySummary(await jobs.datasetInfo(job.datasetId));
		} catch {
			// dataset may be gone; keep the id so the user can re-add files
		}
	}
}

// reset everything to a clean New-Job state
function resetForm() {
	engine.value = 'doc2lora';
	machineId.value = '';
	docBaseModel.value = DEFAULT_BASE_MODELS[0]?.model ?? '';
	peftBaseModel.value = '';
	accelBaseModel.value = '';
	autoPublish.value = false;
	autoUploadFinetune.value = false;
	accountId.value = '';
	hfToken.value = '';
	docUrl.value = '';
	datasetId.value = '';
	datasetFiles.value = [];
	datasetTotalBytes.value = 0;
	targetModulesText.value = '';
	config.rank = 8;
	config.loraAlpha = 16;
	config.loraDropout = 0.1;
	config.epochs = 3;
	config.learningRate = 0.0005;
	config.maxLength = 512;
	config.batchSize = 4;
	config.gradientAccumulationSteps = 1;
	config.load4bit = false;
	config.device = 'auto';
	config.abortOnError = true;
	config.pythonFile = '';
	config.hfDataset = '';
	config.hfConfig = '';
	config.hfSplit = 'train';
	config.textField = '';
	config.textTemplate = '';
	config.captionColumn = '';
	config.resolution = 512;
	config.maxSteps = undefined;
	config.useVenv = true;
	config.pythonVersion = '3.11';
	config.useSudo = false;
	config.doc2loraExtras = 'docs';
	config.outputName = '';
	config.outputSlug = '';
	sudoPassword.value = '';
	sudoUser.value = '';
	hfQuery.value = '';
	hfResults.value = [];
	showHfResults.value = false;
	hfStatus.value = null;
	error.value = '';
}

// on open: apply prefill (or reset), then ping the chosen machine to refresh health + gpu
watch(
	() => props.open,
	async (isOpen) => {
		if (!isOpen) return;
		if (props.prefill) await applyPrefill(props.prefill);
		else resetForm();
		if (machineId.value) pingMachine(machineId.value);
	}
);

// ---- live eta (doc2lora) ----
const selectedMachine = computed(() => machines.value.find((m) => m.id === machineId.value));
// name placeholder shows the server default ("<machine> adapter")
const outputNamePlaceholder = computed(
	() => `${selectedMachine.value?.label ?? 'machine'} adapter`
);
// prefill the sudo username with the ssh user (the user can override it); leave blank otherwise
watch([machineId, () => config.useSudo], () => {
	if (config.useSudo && !sudoUser.value && selectedMachine.value)
		sudoUser.value = selectedMachine.value.username;
});
// prepared-deps state for the current machine + parser scope
const prepInfo = computed(() => {
	if (engine.value !== 'doc2lora' || !selectedMachine.value) return null;
	const p = selectedMachine.value.systemInfo?.prepared ?? null;
	if (!p) {
		// uv cache warm or a prep venv exists, so installs are seconds not minutes
		if (selectedMachine.value.systemInfo?.depsCached === true)
			return {
				color: 'success' as const,
				title: 'Dependencies Cached',
				desc: 'This machine has the training stack cached, so installs take seconds. Running the Machines tab Prepare action is optional.'
			};
		return {
			color: 'info' as const,
			title: 'Machine Not Prepared',
			desc: 'The first run downloads the training stack (~2GB). Prepare this machine from the Machines tab to make runs start fast.'
		};
	}
	if (p.status === 'preparing')
		return {
			color: 'info' as const,
			title: 'Preparing Dependencies',
			desc: 'This machine is downloading and caching the training stack in the background.'
		};
	// ready
	if (doc2loraScopeCovers(p.doc2loraExtras, config.doc2loraExtras)) {
		const bits = [p.torch ? `torch ${p.torch}` : null, p.cuda ? `CUDA ${p.cuda}` : null]
			.filter(Boolean)
			.join(', ');
		return {
			color: 'success' as const,
			title: `Prepared: doc2lora[${p.doc2loraExtras}]`,
			desc: bits ? `Cache warm (${bits}). Runs start fast.` : 'Cache warm. Runs start fast.'
		};
	}
	return {
		color: 'warning' as const,
		title: 'Prepared Scope Is Narrower',
		desc: `This machine is prepared for doc2lora[${p.doc2loraExtras}] but you selected ${config.doc2loraExtras}. The extra parsers will install at run time, or re-prepare the machine for ${config.doc2loraExtras}.`
	};
});
const estimatedGpu = computed<'cpu' | 'mps' | 'cuda'>(() => {
	if (config.device === 'cpu' || config.device === 'mps' || config.device === 'cuda')
		return config.device;
	// auto: a machine reporting gpu info implies cuda
	return selectedMachine.value?.gpuInfo ? 'cuda' : 'cuda';
});
const etaLabel = computed(() => {
	if (!datasetFiles.value.length) return 'Add documents to estimate';
	// archives extract larger than their upload size, so inflate them for the estimate
	const corpusBytes = estimatedCorpusBytes(datasetFiles.value);
	if (!corpusBytes) return 'Add documents to estimate';
	const secs = estimateTrainingSeconds({
		corpusBytes,
		baseModel: docBaseModel.value,
		gpu: estimatedGpu.value,
		epochs: config.epochs,
		load4bit: config.load4bit,
		// a fresh machine pays the cold ML-stack download before training starts
		toolingReady: selectedMachine.value?.toolingReady
	});
	return formatDuration(secs);
});

const canSubmit = computed(() => {
	if (!machineId.value || submitting.value || datasetBusy.value) return false;
	if (engine.value === 'doc2lora') return !!datasetFiles.value.length && !!docBaseModel.value;
	if (engine.value === 'accelerate') return !!accelBaseModel.value.trim() && !!config.hfDataset;
	return !!peftBaseModel.value.trim() && !!config.hfDataset;
});

function onOpenChange(value: boolean) {
	emit('update:open', value);
	if (!value) fullscreen.value = false;
}
function close() {
	fullscreen.value = false;
	emit('update:open', false);
}

async function onSubmit(_event: FormSubmitEvent<any>) {
	if (engine.value === 'doc2lora' && !datasetFiles.value.length) {
		error.value = 'Add documents first';
		return;
	}
	if (engine.value !== 'doc2lora' && !config.hfDataset) {
		error.value = 'Pick a HuggingFace dataset first';
		return;
	}
	submitting.value = true;
	error.value = '';
	try {
		// re-test the connection before launching; do not submit on a bad result
		const diag = await pingMachine(machineId.value);
		if (diag && !diag.ok) {
			error.value = diag.message || 'The machine is not reachable. Fix the connection and retry.';
			toast.add({
				title: 'Connection Failed',
				description: error.value,
				color: 'error',
				icon: 'mdi:lan-disconnect'
			});
			submitting.value = false;
			return;
		}

		const targetModules = targetModulesText.value
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		const isDoc = engine.value === 'doc2lora';
		const isPeft = engine.value === 'peft';
		const isAccel = engine.value === 'accelerate';
		const payload: TrainingJobCreateInput = {
			machineId: machineId.value,
			engine: engine.value,
			// doc2lora carries an uploaded dataset; peft/accelerate load from hf
			datasetId: isDoc ? datasetId.value : undefined,
			inputKind: isDoc ? 'documents' : 'dataset',
			config: {
				baseModel: baseModel.value,
				// doc2lora sets modelType from the curated base; others omit it (server derives)
				modelType: isDoc ? docModelType.value : undefined,
				rank: config.rank,
				loraAlpha: config.loraAlpha,
				loraDropout: config.loraDropout,
				epochs: config.epochs,
				learningRate: config.learningRate,
				maxLength: config.maxLength,
				batchSize: config.batchSize,
				gradientAccumulationSteps: config.gradientAccumulationSteps,
				load4bit: config.load4bit,
				device: config.device,
				targetModules,
				abortOnError: config.abortOnError,
				useVenv: config.useVenv,
				pythonVersion: config.pythonVersion || '3.11',
				useSudo: config.useSudo,
				// only doc2lora consumes the parser scope; default 'docs' for the others
				doc2loraExtras: isDoc ? config.doc2loraExtras : 'docs',
				// optional output adapter overrides; blank -> server defaults
				outputName: config.outputName.trim() || undefined,
				outputSlug: config.outputSlug.trim() || undefined,
				...(isPeft
					? {
							hfDataset: config.hfDataset,
							hfConfig: config.hfConfig || undefined,
							hfSplit: config.hfSplit || 'train',
							textField: config.textField || undefined,
							textTemplate: config.textTemplate || undefined,
							pythonFile: config.pythonFile || undefined
						}
					: {}),
				...(isAccel
					? {
							hfDataset: config.hfDataset,
							hfSplit: config.hfSplit || 'train',
							captionColumn: config.captionColumn || undefined,
							resolution: config.resolution,
							maxSteps: config.maxSteps || undefined
						}
					: {})
			},
			autoPublish: !isAccel && canPublish.value && autoPublish.value,
			autoUploadFinetune: !isAccel && canUploadFinetune.value && autoUploadFinetune.value,
			accountId:
				!isAccel && autoUploadFinetune.value && canUploadFinetune.value && accountId.value
					? accountId.value
					: undefined,
			hfToken: hfToken.value || undefined,
			// ephemeral sudo creds; only sent when sudo is on (password may be blank -> ssh password)
			sudoUser: config.useSudo ? sudoUser.value || undefined : undefined,
			sudoPassword: config.useSudo && sudoPassword.value ? sudoPassword.value : undefined
		};
		const res = await jobs.create(payload);
		toast.add({ title: 'Training launched', color: 'success', icon: 'mdi:rocket-launch' });
		emit('submit', res.id);
		close();
	} catch (e: any) {
		error.value =
			e?.data?.statusMessage ?? e?.data?.message ?? e?.message ?? 'Failed to launch training';
	} finally {
		submitting.value = false;
	}
}
</script>
