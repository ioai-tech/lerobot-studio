import {
  DatasetSourceSelector,
  LeRobotStudioProvider,
  LeRobotViewer,
  LeRobotViewerContent,
  Pagination,
  SampleDatasetCard,
  createArchiveDataSourceFromFile,
  createArchiveDataSourceFromUrl,
  createDirectoryDataSource,
  createRemoteManifestDataSource,
  useDragAndDrop,
} from '@ioai/lerobot-studio';
import type {
  DataSource,
  DatasetSourceSelectorProps,
  DirectoryFile,
  DragAndDropCallbacks,
  LeRobotStudioProviderProps,
  LeRobotViewerProps,
  PaginationProps,
  ParsedSourceUrl,
  RemoteFileEntry,
  SampleDataset,
  SampleDatasetCardProps,
} from '@ioai/lerobot-studio';

const source: DataSource | null = null;
const props: LeRobotViewerProps = { dataSource: 'https://example.com/dataset.zip' };
const files: RemoteFileEntry[] = [];
const providerProps: LeRobotStudioProviderProps = { children: null };
const selectorProps: DatasetSourceSelectorProps = {
  onOpenDirectory: () => {},
  onOpenLocalArchive: () => {},
  onOpenRemoteArchive: () => {},
};
const sample: SampleDataset = { id: '1', name: 'demo', description: '' };
const cardProps: SampleDatasetCardProps = { sample, onSelect: () => {} };
const paginationProps: PaginationProps = {
  count: 0,
  page: 0,
  onPageChange: () => {},
  rowsPerPage: 10,
  onRowsPerPageChange: () => {},
};
const requested: ParsedSourceUrl | null = null;
const dropped: DirectoryFile[] = [];
const drag: DragAndDropCallbacks = { onFile: () => {} };

void source;
void props;
void files;
void providerProps;
void selectorProps;
void sample;
void cardProps;
void paginationProps;
void requested;
void dropped;
void drag;
void LeRobotViewer;
void LeRobotViewerContent;
void LeRobotStudioProvider;
void DatasetSourceSelector;
void SampleDatasetCard;
void Pagination;
void createArchiveDataSourceFromFile;
void createArchiveDataSourceFromUrl;
void createRemoteManifestDataSource;
void createDirectoryDataSource;
void useDragAndDrop;
