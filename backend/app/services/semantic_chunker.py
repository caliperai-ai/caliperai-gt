"""
Semantic Chunker - Intelligent document chunking for RAG

Uses embedding-based similarity to find natural semantic breaks in text.
Produces coherent chunks that maintain context for better retrieval.
"""
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from app.core.config import settings


@dataclass
class DocumentChunk:
    """Represents a chunk of a document with metadata."""
    
    content: str
    source_file: str
    chunk_index: int
    start_char: int
    end_char: int
    metadata: dict = field(default_factory=dict)
    content_hash: str = ""
    
    def __post_init__(self):
        if not self.content_hash:
            self.content_hash = hashlib.md5(self.content.encode()).hexdigest()
    
    @property
    def title(self) -> str:
        """Extract title from metadata or generate from content."""
        if "title" in self.metadata:
            return self.metadata["title"]
        first_line = self.content.split("\n")[0].strip()
        if first_line.startswith("#"):
            return first_line.lstrip("#").strip()
        return f"Chunk {self.chunk_index} from {Path(self.source_file).name}"


class SemanticChunker:
    """
    Chunks documents using semantic similarity to find natural breaks.
    
    The chunker works as follows:
    1. Split document into sentences
    2. Generate embeddings for each sentence
    3. Calculate similarity between adjacent sentence groups
    4. Split at points where similarity drops (semantic boundaries)
    5. Merge small chunks and split large ones
    """
    
    def __init__(
        self,
        embedding_service: "EmbeddingService" = None,
        chunk_size: int = None,
        chunk_overlap: int = None,
        similarity_threshold: float = 0.5,
    ):
        self.embedding_service = embedding_service
        self.chunk_size = chunk_size or settings.RAG_CHUNK_SIZE
        self.chunk_overlap = chunk_overlap or settings.RAG_CHUNK_OVERLAP
        self.similarity_threshold = similarity_threshold
    
    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences, preserving code blocks and lists."""
        code_blocks = re.findall(r'```[\s\S]*?```', text)
        for i, block in enumerate(code_blocks):
            text = text.replace(block, f"__CODE_BLOCK_{i}__")
        
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        
        expanded = []
        for sentence in sentences:
            parts = sentence.split('\n\n')
            for part in parts:
                if part.strip():
                    expanded.append(part.strip())
        
        restored = []
        for sentence in expanded:
            for i, block in enumerate(code_blocks):
                sentence = sentence.replace(f"__CODE_BLOCK_{i}__", block)
            restored.append(sentence)
        
        return restored
    
    def _cosine_similarity(
        self,
        vec1: List[float],
        vec2: List[float],
    ) -> float:
        """Calculate cosine similarity between two vectors."""
        a = np.array(vec1)
        b = np.array(vec2)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))
    
    def _group_sentences(
        self,
        sentences: List[str],
        group_size: int = 3,
    ) -> List[str]:
        """Group sentences for embedding (provides more context)."""
        groups = []
        for i in range(0, len(sentences), group_size):
            group = sentences[i:i + group_size]
            groups.append(" ".join(group))
        return groups
    
    async def _find_semantic_breaks(
        self,
        sentences: List[str],
    ) -> List[int]:
        """
        Find indices where semantic content shifts.
        
        Uses embedding similarity between adjacent sentence groups
        to identify natural topic boundaries.
        """
        if len(sentences) < 4:
            return []
        
        groups = self._group_sentences(sentences, group_size=2)
        
        if not groups or len(groups) < 2:
            return []
        
        embeddings = await self.embedding_service.embed_batch(groups)
        
        breaks = []
        similarities = []
        
        for i in range(len(embeddings) - 1):
            sim = self._cosine_similarity(embeddings[i], embeddings[i + 1])
            similarities.append(sim)
        
        if not similarities:
            return []
        
        mean_sim = np.mean(similarities)
        std_sim = np.std(similarities)
        threshold = mean_sim - std_sim * 0.5
        
        for i, sim in enumerate(similarities):
            if sim < threshold:
                sentence_idx = (i + 1) * 2
                if sentence_idx < len(sentences):
                    breaks.append(sentence_idx)
        
        return breaks
    
    def _merge_small_chunks(
        self,
        chunks: List[str],
        min_size: int = None,
    ) -> List[str]:
        """Merge chunks that are too small."""
        min_size = min_size or self.chunk_size // 4
        merged = []
        buffer = ""
        
        for chunk in chunks:
            if len(buffer) + len(chunk) < self.chunk_size:
                buffer = buffer + "\n\n" + chunk if buffer else chunk
            else:
                if buffer:
                    merged.append(buffer)
                buffer = chunk
        
        if buffer:
            merged.append(buffer)
        
        return merged
    
    def _split_large_chunks(
        self,
        chunks: List[str],
    ) -> List[str]:
        """Split chunks that exceed max size, respecting paragraph boundaries."""
        max_size = self.chunk_size * 2
        result = []
        
        for chunk in chunks:
            if len(chunk) <= max_size:
                result.append(chunk)
                continue
            
            paragraphs = chunk.split('\n\n')
            current = ""
            
            for para in paragraphs:
                if len(current) + len(para) < self.chunk_size:
                    current = current + "\n\n" + para if current else para
                else:
                    if current:
                        result.append(current)
                    if len(para) > self.chunk_size:
                        words = para.split()
                        current = ""
                        for word in words:
                            if len(current) + len(word) < self.chunk_size:
                                current = current + " " + word if current else word
                            else:
                                result.append(current)
                                current = word
                    else:
                        current = para
            
            if current:
                result.append(current)
        
        return result
    
    def _add_overlap(
        self,
        chunks: List[str],
    ) -> List[str]:
        """Add overlap between chunks for context continuity."""
        if self.chunk_overlap <= 0 or len(chunks) <= 1:
            return chunks
        
        overlapped = []
        for i, chunk in enumerate(chunks):
            if i > 0:
                prev_chunk = chunks[i - 1]
                overlap_text = prev_chunk[-self.chunk_overlap:]
                space_idx = overlap_text.find(' ')
                if space_idx > 0:
                    overlap_text = overlap_text[space_idx + 1:]
                chunk = f"...{overlap_text}\n\n{chunk}"
            overlapped.append(chunk)
        
        return overlapped
    
    async def chunk_text(
        self,
        text: str,
        source_file: str = "unknown",
        metadata: dict = None,
    ) -> List[DocumentChunk]:
        """
        Chunk text using semantic analysis.
        
        Args:
            text: Text content to chunk
            source_file: Source file path
            metadata: Additional metadata to attach to chunks
            
        Returns:
            List of DocumentChunk objects
        """
        metadata = metadata or {}
        
        if not text or len(text.strip()) < 50:
            if text.strip():
                return [DocumentChunk(
                    content=text.strip(),
                    source_file=source_file,
                    chunk_index=0,
                    start_char=0,
                    end_char=len(text),
                    metadata=metadata,
                )]
            return []
        
        sentences = self._split_into_sentences(text)
        
        if not sentences:
            return []
        
        if self.embedding_service and len(sentences) > 5:
            try:
                break_points = await self._find_semantic_breaks(sentences)
            except Exception as e:
                break_points = []
        else:
            break_points = []
        
        if break_points:
            chunks = []
            prev_idx = 0
            for break_idx in sorted(set(break_points)):
                chunk_sentences = sentences[prev_idx:break_idx]
                if chunk_sentences:
                    chunks.append("\n".join(chunk_sentences))
                prev_idx = break_idx
            
            if prev_idx < len(sentences):
                chunks.append("\n".join(sentences[prev_idx:]))
        else:
            chunks = ["\n".join(sentences)]
        
        chunks = self._merge_small_chunks(chunks)
        chunks = self._split_large_chunks(chunks)
        chunks = self._add_overlap(chunks)
        
        result = []
        char_offset = 0
        
        for i, chunk_content in enumerate(chunks):
            chunk_start = text.find(chunk_content[:50], char_offset)
            if chunk_start == -1:
                chunk_start = char_offset
            
            chunk = DocumentChunk(
                content=chunk_content,
                source_file=source_file,
                chunk_index=i,
                start_char=chunk_start,
                end_char=chunk_start + len(chunk_content),
                metadata={
                    **metadata,
                    "total_chunks": len(chunks),
                },
            )
            result.append(chunk)
            char_offset = chunk_start + len(chunk_content)
        
        return result
    
    async def chunk_markdown(
        self,
        text: str,
        source_file: str = "unknown",
    ) -> List[DocumentChunk]:
        """
        Chunk markdown document, respecting headers as natural boundaries.
        
        This method is optimized for markdown files which have
        explicit structure via headers.
        """
        metadata = {}
        if text.startswith("---"):
            end_idx = text.find("---", 3)
            if end_idx > 0:
                frontmatter = text[3:end_idx].strip()
                for line in frontmatter.split("\n"):
                    if ":" in line:
                        key, value = line.split(":", 1)
                        metadata[key.strip()] = value.strip()
                text = text[end_idx + 3:].strip()
        
        sections = re.split(r'\n(?=##+ )', text)
        
        chunks = []
        for section in sections:
            section = section.strip()
            if not section:
                continue
            
            section_title = None
            if section.startswith("#"):
                first_line = section.split("\n")[0]
                section_title = first_line.lstrip("#").strip()
            
            section_meta = {**metadata}
            if section_title:
                section_meta["section"] = section_title
            
            section_chunks = await self.chunk_text(
                section,
                source_file=source_file,
                metadata=section_meta,
            )
            chunks.extend(section_chunks)
        
        for i, chunk in enumerate(chunks):
            chunk.chunk_index = i
            chunk.metadata["total_chunks"] = len(chunks)
        
        return chunks
    
    def chunk_simple(
        self,
        text: str,
        source_file: str = "unknown",
        metadata: dict = None,
    ) -> List[DocumentChunk]:
        """
        Simple character-based chunking (synchronous, no embeddings).
        
        Use this as a fallback when embedding service is unavailable.
        """
        metadata = metadata or {}
        
        if not text or len(text.strip()) < 50:
            if text.strip():
                return [DocumentChunk(
                    content=text.strip(),
                    source_file=source_file,
                    chunk_index=0,
                    start_char=0,
                    end_char=len(text),
                    metadata=metadata,
                )]
            return []
        
        paragraphs = text.split('\n\n')
        chunks = []
        current_chunk = ""
        chunk_start = 0
        
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            
            if len(current_chunk) + len(para) < self.chunk_size:
                current_chunk = current_chunk + "\n\n" + para if current_chunk else para
            else:
                if current_chunk:
                    chunks.append((current_chunk, chunk_start))
                    chunk_start += len(current_chunk) + 2
                current_chunk = para
        
        if current_chunk:
            chunks.append((current_chunk, chunk_start))
        
        result = []
        for i, (content, start) in enumerate(chunks):
            result.append(DocumentChunk(
                content=content,
                source_file=source_file,
                chunk_index=i,
                start_char=start,
                end_char=start + len(content),
                metadata={
                    **metadata,
                    "total_chunks": len(chunks),
                },
            ))
        
        return result
