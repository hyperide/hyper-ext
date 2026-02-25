import { IconPhoto, IconUpload, IconX, IconLoader2 } from '@tabler/icons-react';
import cn from 'clsx';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import {
	type ChangeEvent,
	type DragEvent,
	useEffect,
	useRef,
	useState,
} from 'react';
import { authFetch } from '@/utils/authFetch';

interface ImageInfo {
	name: string;
	path: string;
	publicUrl: string;
	size: number;
	modified: number;
}

interface ImageBackgroundPickerProps {
	value: string | null;
	onChange: (path: string | null) => void;
	disabled?: boolean;
	projectId: string;
	placeholder?: string;
	className?: string;
}

export function ImageBackgroundPicker({
	value,
	onChange,
	disabled = false,
	projectId,
	placeholder = 'Select image...',
	className,
}: ImageBackgroundPickerProps) {
	const [open, setOpen] = useState(false);
	const [images, setImages] = useState<ImageInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Load images when popover opens
	useEffect(() => {
		if (open && projectId) {
			loadImages();
		}
	}, [open, projectId]);

	const loadImages = async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await authFetch(`/api/projects/${projectId}/images`);
			const data = await response.json();
			if (data.success) {
				setImages(data.images || []);
			} else {
				setError(data.error || 'Failed to load images');
			}
		} catch (err) {
			setError('Failed to load images');
			console.error('[ImageBackgroundPicker] Load error:', err);
		} finally {
			setLoading(false);
		}
	};

	const uploadImage = async (file: File) => {
		setUploading(true);
		setError(null);
		try {
			const formData = new FormData();
			formData.append('file', file);

			const response = await authFetch(`/api/projects/${projectId}/upload-image`, {
				method: 'POST',
				body: formData,
			});

			const data = await response.json();
			if (data.success) {
				// Reload images and select the new one
				await loadImages();
				onChange(data.publicUrl);
			} else {
				setError(data.error || 'Failed to upload image');
			}
		} catch (err) {
			setError('Failed to upload image');
			console.error('[ImageBackgroundPicker] Upload error:', err);
		} finally {
			setUploading(false);
		}
	};

	const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			uploadImage(file);
		}
		// Reset input so same file can be selected again
		e.target.value = '';
	};

	const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(true);
	};

	const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
	};

	const handleDrop = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);

		const file = e.dataTransfer.files?.[0];
		if (file && file.type.startsWith('image/')) {
			uploadImage(file);
		} else {
			setError('Please drop an image file');
		}
	};

	const handleSelect = (publicUrl: string) => {
		onChange(publicUrl);
		setOpen(false);
	};

	const handleClear = () => {
		onChange(null);
		setOpen(false);
	};

	// Build preview URL for iframe context
	const getPreviewUrl = (publicUrl: string) => {
		return `/project-preview/${projectId}${publicUrl}`;
	};

	return (
		<div className={cn('flex items-center gap-0.5', className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						disabled={disabled}
						className={cn(
							'flex items-center gap-1.5 h-6 px-2 bg-gray-100 rounded text-xs transition-colors flex-1',
							disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-200',
						)}
					>
						{value ? (
							<>
								<img
									src={getPreviewUrl(value)}
									alt=""
									className="w-4 h-4 rounded object-cover flex-shrink-0"
									onError={(e) => {
										(e.target as HTMLImageElement).style.display = 'none';
									}}
								/>
								<span className="text-gray-700 text-left font-mono text-[10px] w-[120px] flex">
									<span className="truncate grow">
										{value.replace(/\.[^.]+$/, '')}
									</span>
									<span className="flex-shrink-0">
										{value.match(/\.[^.]+$/)?.[0] || ''}
									</span>
								</span>
							</>
						) : (
							<>
								<IconPhoto className="w-3 h-3 text-gray-400" stroke={1.5} />
								<span className="text-gray-500 truncate flex-1 text-left">
									{placeholder}
								</span>
							</>
						)}
					</button>
				</PopoverTrigger>
				<PopoverContent className="w-[280px] p-0" align="start">
					<div className="p-2 space-y-2">
						{/* Upload drop zone */}
						<div
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							onClick={() => fileInputRef.current?.click()}
							className={cn(
								'h-14 border-2 border-dashed rounded-md flex flex-col items-center justify-center cursor-pointer transition-colors',
								isDragging
									? 'border-blue-500 bg-blue-50'
									: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50',
							)}
						>
							{uploading ? (
								<IconLoader2 className="w-5 h-5 text-gray-400 animate-spin" />
							) : (
								<>
									<IconUpload className="w-5 h-5 text-gray-400" stroke={1.5} />
									<span className="text-[10px] text-gray-500 mt-1">
										Drop image or click to upload
									</span>
								</>
							)}
						</div>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							onChange={handleFileSelect}
							className="hidden"
						/>

						{/* Error message */}
						{error && <div className="text-xs text-red-600 px-1">{error}</div>}

						{/* None option */}
						<button
							type="button"
							onClick={handleClear}
							className={cn(
								'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors',
								!value ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100',
							)}
						>
							<IconX className="w-4 h-4" stroke={1.5} />
							<span>None</span>
						</button>

						{/* Divider */}
						<div className="border-t border-gray-200" />

						{/* Images gallery */}
						<div className="max-h-[200px] overflow-y-auto">
							{loading ? (
								<div className="flex items-center justify-center py-4">
									<IconLoader2 className="w-5 h-5 text-gray-400 animate-spin" />
								</div>
							) : images.length === 0 ? (
								<div className="text-xs text-gray-500 text-center py-4">
									No images in public directory
								</div>
							) : (
								<div className="grid grid-cols-3 gap-1">
									{images.map((image) => (
										<button
											key={image.publicUrl}
											type="button"
											onClick={() => handleSelect(image.publicUrl)}
											title={image.publicUrl}
											className={cn(
												'aspect-square rounded border overflow-hidden transition-all hover:scale-105',
												value === image.publicUrl
													? 'ring-2 ring-blue-500 border-blue-500'
													: 'border-gray-200 hover:border-gray-400',
											)}
										>
											<img
												src={getPreviewUrl(image.publicUrl)}
												alt={image.name}
												className="w-full h-full object-cover"
												loading="lazy"
												onError={(e) => {
													(e.target as HTMLImageElement).src =
														'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect fill="%23f3f4f6" width="24" height="24"/><text x="12" y="14" text-anchor="middle" font-size="8" fill="%239ca3af">?</text></svg>';
												}}
											/>
										</button>
									))}
								</div>
							)}
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
